# Privacy policy: T3 G2

_Last updated: 2026-10-27_

T3 G2 is a client for [T3 Code](https://github.com/pingdotgg/t3code) servers that you run yourself. It has no backend of its own, no accounts, no analytics and no tracking.

## What the app connects to

Only the T3 Code servers you pair it with, at the addresses you enter or approve. Nothing is sent to the developer of this app or to any other third party.

## Permissions

| Permission | What it is used for |
|---|---|
| **Network** | Reading your pinned threads from your own T3 server and sending your messages to it. The app's network whitelist covers Tailscale HTTPS addresses (`*.ts.net`) used to reach self-hosted servers. |
| **Glasses microphone** | Recording a voice message while you hold the touchpad. Recording starts only while you hold, and stops when you release, double tap, or leave the app. |

## Voice recordings

A recording is uploaded as a WAV file only to the T3 server you are talking to, as an attachment on your thread, and only when you release to send. Empty, very short or silent recordings are discarded on the device and never uploaded. Transcription happens on your T3 machine, by the agent, using whatever speech-to-text that machine has. This app does not transcribe audio or send it anywhere else. In demo mode nothing is uploaded at all.

## Stored on your phone

- The address of each paired server and its access token (issued by your server when you pair, revocable there at any time with `t3 auth session revoke`).
- Your settings for new threads, and which threads you have already seen.

These stay in the Even Realities app's storage on your phone. Removing a machine in the app deletes its token.

## Contact

Questions or issues: open an issue at https://github.com/xrehpicx/t3-g2/issues
