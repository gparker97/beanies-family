# P1 — Deployed read paths for a `version: "5.0"` pod (audit of `c3a6be98`)

> Date: 2026-09-06
> Build audited: `c3a6be98` (release 0.16, the last prod deploy). Every `file:line` below is from that commit, read with `git show c3a6be98:<path>`.
> Status: INCOMPLETE — draft written early so it survives; being extended.

## Verdict

**PREMISE FAILS.** The deployed build cannot MERGE a v5 pod (every merge entry point sits behind a strict `'4.0'` check), but it CAN destroy one: the create-path collision resolver classifies any non-`'4.0'` file as an empty placeholder and adopts it as the write target for a brand-new pod. Details in Finding 1.

_(Findings, path table and safe list follow; being filled in.)_
