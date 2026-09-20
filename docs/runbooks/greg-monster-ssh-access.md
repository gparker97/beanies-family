# Runbook: SSH access to `greg-monster` over Tailscale

> Created 2026-09-20, after a "connection refused" incident diagnosed from `greg-xps15`.
> Applies to the dev-machine hop only — nothing here touches app code or deploys.

## The shape of the setup

`greg-monster` is a **Windows** host (`tailscale status` reports `OS = windows`) whose SSH
daemon lives **inside WSL2**, published to the Windows host on port **2222**. `docs/STATUS.md`
records the same thing from the OpenClaw hosting discussion: _"greg-monster on WSL vs native
Linux vs Lightsail (WSL2 needs systemd enabled + Windows sleep disabled)"_.

The client side is `~/.ssh/config` on `greg-xps15` (not in this repo):

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

Tailnet addresses: `greg-xps15` = `100.105.153.36`, `greg-monster` = `100.95.141.53`.
Tailscale is **not** installed inside WSL on `greg-xps15` — drive it through the Windows binary
at `/mnt/c/Program Files/Tailscale/tailscale.exe`.

## Triage: is it Tailscale, or is it sshd?

**Read the failure mode before touching anything. It tells you which half is broken.**

| Symptom                             | Meaning                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Connection refused`, **instantly** | Tailnet is FINE. The packet arrived and `greg-monster` sent an RST — **nothing is listening on 2222**. Go to _sshd is down_. |
| Hang, then `Connection timed out`   | Packets are being dropped — Tailscale, an ACL, or a host firewall. Go to _Tailscale checks_.                                 |
| `Could not resolve hostname`        | MagicDNS. `getent hosts greg-monster` should return `100.95.141.53`.                                                         |

Confirm the tunnel independently of SSH:

```bash
'/mnt/c/Program Files/Tailscale/tailscale.exe' status
'/mnt/c/Program Files/Tailscale/tailscale.exe' ping greg-monster   # expect a pong in single-digit ms
```

A healthy result looks like `pong from greg-monster (100.95.141.53) via 192.168.2.57:41641 in 6ms`
— a **direct** LAN path. `via DERP(sin)` also works, just relayed.

⚠️ **A node showing `idle` / online in `tailscale status` says nothing about sshd.** That is the
trap this runbook exists for: Tailscale is a native Windows service and stays up happily while the
WSL VM — and therefore sshd — is gone.

Probe the port directly, which removes SSH's own config from the question:

```bash
timeout 6 bash -c 'echo > /dev/tcp/100.95.141.53/2222'
```

## sshd is down — fix it on `greg-monster`

At the machine (or via RDP), in PowerShell:

```powershell
wsl -l -v                                    # distro name + is it Running?
wsl.exe -d Ubuntu -u root service ssh start  # substitute the real distro name
```

Use `service ssh start`, **not** `systemctl`, unless systemd has been enabled in `/etc/wsl.conf`
since the STATUS.md note above. If sshd starts but the connection is still refused, the publish
layer is the problem:

```powershell
netsh interface portproxy show v4tov4
Get-NetTCPConnection -LocalPort 2222 -State Listen -ErrorAction SilentlyContinue
Get-Content $env:USERPROFILE\.wslconfig -ErrorAction SilentlyContinue
```

⚠️ **Which publish mechanism is in use has never been verified** — `netsh portproxy` and WSL
mirrored networking both fit the evidence. Whoever is next at the keyboard should run the three
lines above and record the answer here.

## Root cause, and making it not recur

WSL2 terminates its VM shortly after the last process exits, and WSL starts no services at boot on
its own. So sshd disappears on every `wsl --shutdown`, every Windows reboot, and whenever the last
WSL window closes — which is exactly why this works most of the time and then doesn't.

Ranked by how much fragility each removes:

1. **Pin WSL up at logon** (fixes the root cause). A task that starts sshd and never exits:

   ```powershell
   schtasks /Create /TN "WSL sshd keepalive" /SC ONLOGON /RL HIGHEST /F `
     /TR "C:\Windows\System32\wsl.exe -d Ubuntu -u root -e /bin/sh -c \"service ssh start; sleep infinity\""
   ```

   Run it as **greg**, not SYSTEM — WSL distros are per-user and a SYSTEM-context task cannot find
   the distro.

2. **WSL mirrored networking**, which retires the stale-WSL-IP failure entirely (WSL binds straight
   to the host's interfaces, Tailscale's included, and the portproxy rule can go). In
   `%USERPROFILE%\.wslconfig`, then `wsl --shutdown`:

   ```ini
   [wsl2]
   networkingMode=mirrored
   ```

   Requires Windows 11 22H2+.

3. **Tailscale "Run unattended"** (tray → Preferences) so the node survives logoff and reboot
   without a login. It looked correct during the 2026-09-20 incident; without it, a clean
   `refused` becomes a much muddier `unreachable`.

4. _Optional._ **Native Windows OpenSSH Server** as an automatic service, independent of the WSL
   lifecycle — the only variant that cannot break the way 2026-09-20 did. More setup, and the
   `LocalForward`s then need mirrored networking to reach the dev servers inside WSL.

**Tailscale SSH is not an option here**: the Tailscale SSH _server_ is Linux-only, and
`TailscaleSSHEnabled` is absent on the `greg-monster` peer. Running Tailscale as its own node
_inside_ WSL would make it available, but still depends on the WSL VM being up — item 1 first.

## Incident log

- **2026-09-20** — `ssh greg-monster` refused from `greg-xps15`. Tailnet verified healthy
  (peer `Online = True`, direct pong in 6ms via `192.168.2.57:41641`); ports 2222, 22 and 3389 all
  refused instantly. Diagnosed as no listener on `greg-monster`, i.e. the WSL VM down. Diagnosis
  only — nothing was changed on `greg-monster`, and none of the four hardening items were applied.
