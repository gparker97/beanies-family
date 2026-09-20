# Runbook: SSH access to a WSL2 dev host over Tailscale

> Created 2026-09-20 after a "connection refused" incident on `greg-monster`, then rewritten the
> same day against that machine's **verified** configuration. The first draft's instructions were
> wrong in five places; see [Corrections](#corrections-to-the-first-draft) before trusting any
> older copy.
>
> Written to be reusable on **any** Windows host that runs sshd inside WSL2 and is reached over
> Tailscale. Host-specific values are gathered in [Step 0](#step-0-gather-the-six-host-facts) and
> referenced as `<placeholders>` after that. `greg-monster`'s real values are in the
> [worked example](#worked-example-greg-monster-as-of-2026-09-20).
>
> Applies to the dev-machine hop only. Nothing here touches app code, infrastructure, or deploys.

## The shape of the setup, and why it breaks

sshd does not run on Windows. It runs **inside a WSL2 distro** on the Windows host, and the port is
reachable on the host's Tailscale address. Four independent layers have to be up at once:

1. Tailscale on Windows, so the node is on the tailnet.
2. A path from the host's tailnet address to the port inside WSL.
3. A Windows Firewall rule allowing that port inbound.
4. sshd itself, inside a **running** distro.

Layers 1 to 3 are Windows-native and, once configured, survive reboots on their own. Layer 4 is the
fragile one, for a structural reason:

> **WSL starts no services at boot, and WSL2 tears down its VM once the distro has no processes
> left.** So sshd disappears on every `wsl --shutdown`, every Windows reboot, and potentially
> whenever the last WSL session closes, while Tailscale, a native Windows **service**, stays online
> and reports the node healthy.

That mismatch is the entire trap. `tailscale status` showing the peer online says nothing about
whether anything is listening.

### Which layers are self-healing

| Layer                   | What makes it survive a reboot                                                                                  | Verify with                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Tailscale on Windows    | Service set to `AUTO_START`, plus `ForceDaemon` ("run unattended")                                              | `sc.exe qc Tailscale`, `tailscale.exe debug prefs`  |
| Port published from WSL | `networkingMode=mirrored` in `.wslconfig` (a file, so persistent)                                               | `ip -4 addr` inside WSL shows the tailnet IP        |
| Firewall                | A named inbound rule on all three profiles                                                                      | `netsh.exe advfirewall firewall show rule name=all` |
| sshd inside the distro  | systemd enabled **and** `ssh.service` enabled                                                                   | `systemctl is-enabled ssh`                          |
| **The distro running**  | **Nothing, by default. This is the gap** ([Step 5](#step-5-the-keepalive-task-the-part-that-actually-fixes-it)) | `wsl.exe -l -v`                                     |

Note the shape of that table: get layers 1 to 4 right once and the only recurring failure is "the
distro is not running". Fix that one thing and the rest follows, because systemd brings sshd up by
itself whenever the distro boots.

## Triage: is it Tailscale, or is it sshd?

**Read the failure mode before touching anything. It tells you which half is broken.**

| Symptom                             | Meaning                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Connection refused`, **instantly** | Tailnet is FINE. The packet arrived and the host sent an RST, so **nothing is listening**. Go to [Step 5](#step-5-the-keepalive-task-the-part-that-actually-fixes-it). |
| Hang, then `Connection timed out`   | Packets are being dropped: Tailscale, an ACL, a host firewall, or a sleeping host. Check the tunnel first.                                                             |
| `Could not resolve hostname`        | MagicDNS. `getent hosts <host>` should return the tailnet IP.                                                                                                          |

An instant refusal cannot be a tunnel fault. A tunnel fault times out; it never refuses.

Confirm the tunnel independently of SSH. If Tailscale is not installed inside WSL, drive the Windows
binary:

```bash
'/mnt/c/Program Files/Tailscale/tailscale.exe' status
'/mnt/c/Program Files/Tailscale/tailscale.exe' ping <host>   # expect single-digit ms
```

A healthy result reads `pong from <host> (<tailnet-ip>) via 192.168.x.y:41641 in 6ms`, a **direct**
LAN path. `via DERP(<region>)` also works, just relayed.

Then probe the port directly, which removes SSH's own config from the question:

```bash
timeout 6 bash -c 'echo > /dev/tcp/<tailnet-ip>/<port>'
```

## Making it survive reboots and WSL death

### Step 0: gather the six host facts

Everything below needs these. Run inside the WSL distro.

```bash
WIN=/mnt/c/Windows/System32
"$WIN/whoami.exe"                 # <win-account>, e.g. greg_monster\gpsp2
"$WIN/whoami.exe" /user           # <win-sid>, the S-1-5-21-... value
echo "$WSL_DISTRO_NAME"           # <distro>, e.g. Ubuntu
ss -tln | grep -E ':22|:2222'     # <port> sshd actually binds
ip -4 addr show                   # <tailnet-ip>, the 100.x interface
"$WIN/wsl.exe" -l -v              # confirm <distro> spelling and state
```

⚠️ **`<win-account>` must be the user the distro is registered under**, not an administrator you
happen to be using. WSL distros are per-user; a task running as another principal cannot see them.
Confirm the owner by finding the profile that holds the distro package:

```bash
ls -d /mnt/c/Users/*/AppData/Local/Packages/*<Distro>*/
```

### Step 1: systemd and sshd inside the distro

In `/etc/wsl.conf`:

```ini
[boot]
systemd = true
```

Then, inside the distro, enable sshd as a unit so systemd starts it on every distro boot:

```bash
sudo systemctl enable --now ssh
systemctl is-enabled ssh    # must print: enabled
```

This is the step that makes everything after it automatic. Once `ssh.service` is `enabled` in
`multi-user.target`, booting the distro is sufficient to get sshd listening; nothing needs to start
it explicitly.

⚠️ **Check whether systemd is enabled before choosing `service` or `systemctl`.** On a
systemd-enabled distro, `systemctl` is correct and `ssh.service` is already wired for boot. Advice
to use `service ssh start` applies only to distros **without** systemd, where a service started by
hand has to be re-started on every distro boot.

Changing `/etc/wsl.conf` needs `wsl --shutdown` to take effect. ⚠️ **That kills every process in the
distro**, including any agent session running inside it. Do it deliberately.

### Step 2: publish the port to the tailnet

Use **mirrored networking**. In `%USERPROFILE%\.wslconfig`, then `wsl --shutdown`:

```ini
[wsl2]
networkingMode = mirrored
firewall = true
dnsTunneling = true

[experimental]
hostAddressLoopback = true
```

WSL then binds straight to the host's interfaces, Tailscale's included, so a daemon bound to
`0.0.0.0:<port>` inside WSL is reachable on the host's tailnet address with no forwarding layer at
all. Verify from inside WSL: `ip -4 addr show` should list an interface holding the **tailnet** IP.

Requires Windows 11 22H2 or later. The alternative, a `netsh interface portproxy` rule pointing at
WSL's address, works but re-introduces the stale-WSL-IP failure (WSL's private IP changes across
restarts), so prefer mirrored and keep `portproxy` empty. `hostAddressLoopback=true` additionally
lets each side reach the other on `localhost`, which is what makes SSH `LocalForward`s to dev servers
work in both directions.

### Step 3: firewall rule

Under mirrored networking, inbound connections hit Windows Firewall. Create one named rule, scoped
to **all three profiles** so it does not stop working when the network category changes:

```powershell
New-NetFirewallRule -DisplayName "WSL SSH <port>" -Direction Inbound `
  -Protocol TCP -LocalPort <port> -Action Allow -Profile Domain,Private,Public
```

### Step 4: Tailscale unattended

Tray icon, Preferences, **Run unattended**, so the node stays on the tailnet across logoff and
reboot without anyone signing in. Verify:

```bash
'/mnt/c/Program Files/Tailscale/tailscale.exe' debug prefs | grep -E 'ForceDaemon|WantRunning|LoggedOut'
```

Want `ForceDaemon: true`, `WantRunning: true`, `LoggedOut: false`. Also confirm the service starts
itself: `sc.exe qc Tailscale` should report `START_TYPE : 2 AUTO_START`.

Without this, a clean `Connection refused` becomes a much muddier `unreachable`, and the triage
table above stops working.

### Step 5: the keepalive task, the part that actually fixes it

Everything above is persistent configuration. This is the only moving part: **something has to start
the distro.** A Scheduled Task with three triggers and an idempotent action.

Save as `wsl-keepalive.xml`, replacing `<distro>`, `<win-account>` and `<win-sid>`:

```xml
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Starts the WSL distro if it is not running, so systemd brings sshd up for Tailscale access. Idempotent no-op when already running.</Description>
    <URI>\WSL keepalive</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId><win-account></UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId><win-sid></UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>C:\Windows\System32\wsl.exe</Command>
      <Arguments>-d <distro> -u root -e /bin/true</Arguments>
    </Exec>
  </Actions>
</Task>
```

Register it from an **elevated** PowerShell. Registration needs admin; running it does not.

```powershell
Register-ScheduledTask -TaskName 'WSL keepalive' `
  -Xml (Get-Content -Raw "C:\path\to\wsl-keepalive.xml") -Force
```

Why each choice, because every one of them is a trap someone will otherwise re-discover:

- **Three triggers in one task.** `BootTrigger` covers a reboot with no delay. `LogonTrigger` covers
  an interactive sign-in. The repeating `TimeTrigger` is the self-healing part: it covers
  `wsl --shutdown` and the VM dying on its own, which no one-shot trigger can.
- **An empty `<Duration>` on the repetition means "indefinitely".** Do not try to express this with
  PowerShell's `New-ScheduledTaskTrigger -RepetitionDuration ([TimeSpan]::MaxValue)`; it serialises
  to `P99999999DT23H59M59S` and registration fails with "value which is incorrectly formatted or out
  of range". Registering from XML is the reliable route.
- **`LogonType` is `S4U`, and the principal is a SID.** S4U authenticates by SID with **no stored
  password**, and still runs whether or not anyone is logged on. This matters more than it looks: on
  a host where the account signs in with a PIN or Windows Hello, the real account password may be
  years stale or Microsoft-Account-backed, and `schtasks /RU <user> /RP <password>` will sit there
  rejecting every password the owner can remember. Do not go down that road.
- **The principal must be the distro owner, never SYSTEM.** WSL distros are per-user, so a
  SYSTEM-context task cannot find one.
- **`RunLevel` is `LeastPrivilege`.** The `-u root` is root _inside_ the distro and needs no Windows
  elevation at run time.
- **The action is `-e /bin/true`, not a service command.** Starting the distro is all that is
  required, because Step 1 made systemd bring sshd up. It is a no-op when the distro is already
  running, so a 5 minute poll costs nothing. Do not add `sleep infinity` to pin the VM up: with
  systemd as PID 1 the distro always has processes, and if that ever proves false on some build, the
  poll recovers it anyway.
- **`IgnoreNew` and a 5 minute `ExecutionTimeLimit`** so a wedged `wsl.exe` cannot stack up.

Verify, unelevated:

```powershell
$t = Get-ScheduledTask -TaskName 'WSL keepalive'
$t.State; $t.Principal | Format-List UserId,LogonType,RunLevel
$t.Triggers | ForEach-Object { $_.CimClass.CimClassName + ' ' + $_.Repetition.Interval }
Start-ScheduledTask -TaskName 'WSL keepalive'
(Get-ScheduledTaskInfo -TaskName 'WSL keepalive') | Format-List LastRunTime,LastTaskResult,NextRunTime
```

Want `State: Ready`, `LogonType: S4U`, three triggers with `PT5M` on the time trigger, and
`LastTaskResult: 0`.

### Step 6: the only test that actually proves it

**Reboot the host, do not log in, then SSH from another tailnet machine.** Everything else can pass
while this fails, because S4U firing before any interactive logon is the one assumption the local
checks cannot exercise. If it refuses:

- Check whether the account holds the **"Log on as a batch job"** right (`secpol.msc`, Local
  Policies, User Rights Assignment). Local administrators normally have it.
- Check `AutoAdminLogon`. If the host autologs in, the `LogonTrigger` covers you regardless and the
  distinction is moot.
- Failing both, fall back to a `Password` principal with a genuinely known credential, accepting the
  stored secret.

Also confirm the host does not simply sleep: a sleeping host drops off the tailnet and **times out**
rather than refusing, which is a different signature and a different fix (`powercfg /change
standby-timeout-ac 0`).

## What does not work, and why

- **Tailscale SSH is not an escape hatch on a Windows host.** The Tailscale SSH _server_ is
  Linux-only, and the peer will show no `TailscaleSSHEnabled`. Running Tailscale as its own node
  _inside_ WSL would make it available, but that still depends on the distro being up, which is the
  problem being solved. Step 5 first.
- **A `[boot] command` in `/etc/wsl.conf` cannot help.** It runs when the distro boots, so it cannot
  be what boots the distro.
- **`ONLOGON`-only tasks do not survive an unattended reboot.** With no autologon, a host sitting at
  the lock screen never fires one.

### Optional: a rescue door

Native **Windows OpenSSH Server** as an automatic service on a _different_ port is the only variant
fully independent of the WSL lifecycle. It gives a way in when the distro cannot boot at all, from
which `wsl` can be run to investigate. With mirrored networking and `hostAddressLoopback=true`
already set, its `LocalForward`s still reach dev servers inside WSL. Treat it as a complement, not a
replacement: the shell lands in PowerShell, and the actual dev environment is still in the distro.

## Worked example: `greg-monster` as of 2026-09-20

Verified on the machine, not inferred.

| Fact               | Value                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Windows host       | `GREG_MONSTER`, Tailscale reports `OS = windows`                                                                               |
| Tailnet name / IP  | `greg-monster.tailb2c0d8.ts.net` / `100.95.141.53`                                                                             |
| Peer client        | `greg-xps15` = `100.105.153.36`                                                                                                |
| `<distro>`         | `Ubuntu` (22.04.2 LTS), WSL `2.7.14.0`, kernel `6.18.33.2-2`                                                                   |
| Second distro      | `docker-desktop` (Stopped). Keep `-d Ubuntu` explicit because of it.                                                           |
| `<win-account>`    | `greg_monster\gpsp2` ("Greg Parker", Administrators + docker-users)                                                            |
| `<win-sid>`        | `S-1-5-21-3746432092-634474719-2222313320-1001`                                                                                |
| Distro owner proof | `/mnt/c/Users/gpsp2/AppData/Local/Packages/CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc/`                                        |
| `<port>`           | `2222`, and sshd binds `0.0.0.0:2222` directly (there is no 22-to-2222 hop)                                                    |
| `/etc/wsl.conf`    | `[boot] systemd=true`, `[interop] appendWindowsPath=false`                                                                     |
| `.wslconfig`       | `networkingMode=mirrored`, `firewall=true`, `dnsTunneling=true`, `autoProxy=true`, `[experimental] hostAddressLoopback=true`   |
| Publish mechanism  | **Mirrored networking. `netsh portproxy` is empty.** WSL sees `eth2 = 192.168.2.57` (LAN) and `eth5 = 100.95.141.53` (tailnet) |
| Firewall rule      | `WSL SSH 2222`, Inbound, TCP 2222, Domain + Private + Public, Allow                                                            |
| Tailscale service  | `AUTO_START`, `LocalSystem`, `ForceDaemon: true`, `WantRunning: true`, `RunSSH: false`                                         |
| Tailscale in WSL   | Not installed, no `tailscale0`. Drive `/mnt/c/Program Files/Tailscale/tailscale.exe`                                           |
| `AutoAdminLogon`   | `0`, so Step 6's unattended-reboot test is the one that matters                                                                |
| Power              | Balanced; AC standby `0` (never), DC `0x258` (10 min), hibernate disabled                                                      |
| Keepalive task     | `WSL Ubuntu keepalive`, registered 2026-09-20, `Ready` / S4U / Limited / 3 triggers / `PT5M` / `LastTaskResult 0`              |

Evidence that Step 1 makes sshd automatic on this host: the distro booted at `11:51:26` and
`ssh.service` reached active at `11:52:25`, with nothing asking it to.

Client side, `~/.ssh/config` on `greg-xps15` (not in this repo, recorded from the first draft and
**not** re-verified on 2026-09-20):

```
Host greg-monster
  HostName greg-monster.tailb2c0d8.ts.net
  Port 2222
  User greg
  ServerAliveInterval 30
  ServerAliveCountMax 3
  LocalForward 5173 localhost:5173   # Vite, so the browser origin stays localhost:5173 and CORS passes
  LocalForward 4321 localhost:4321   # Astro marketing site
```

## Incident log

- **2026-09-20 (diagnosis)**: `ssh greg-monster` refused from `greg-xps15`. Tailnet verified healthy
  independently of SSH (peer `Online = True`, direct pong in 6ms via `192.168.2.57:41641`), while
  ports 2222, 22 and 3389 all refused instantly. Diagnosed as no listener, i.e. the distro down.
  Nothing was changed.
- **2026-09-20 (fix)**: configuration audited on the host itself. Three of the first draft's four
  proposed hardening items turned out to be **already in place**; the real gap was the missing
  keepalive. Task registered and verified (`LastTaskResult 0`, next run on a 5 minute cadence).
  ⏳ **Still owed: the Step 6 unattended-reboot test.** Until it runs, the pre-logon boot trigger is
  verified only by inspection.

## Corrections to the first draft

The 2026-09-20 first draft of this runbook was written from the client side, without reading
`greg-monster`'s configuration. Five of its claims were wrong, and are corrected above:

1. **"Use `service ssh start`, not `systemctl`, unless systemd has been enabled"**: systemd **is**
   enabled, and `ssh.service` is enabled in `multi-user.target`.
2. **Mirrored networking listed as hardening to apply**: already configured, and working.
3. **Tailscale "run unattended" listed as unconfirmed**: confirmed, `ForceDaemon: true`.
4. **"Which publish mechanism is in use has never been verified"**: it is mirrored networking.
   `netsh portproxy` is empty, and there is a pinned firewall rule.
5. **The native-OpenSSH option's caveat, that `LocalForward`s "then need mirrored networking"**:
   void, since mirrored networking is already on.

It also recommended a keepalive shaped for a **non-systemd** distro (`service ssh start; sleep
infinity`) on an `ONLOGON` trigger, which would not have survived an unattended reboot and could not
have recovered from the distro dying. [Step 5](#step-5-the-keepalive-task-the-part-that-actually-fixes-it)
replaces it.

**The transferable lesson: audit the host before writing the fix.** Three of four recommendations
were already done, and the one that was missing was the only one that mattered.
