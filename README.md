# Matts Better Audio Control

A Windows Stream Deck plugin for Elgato Wave Link. Wave Link stays in charge of routing and volume. This plugin does not change the Windows default audio device.

## Actions

- **Wave Link Main Output** adjusts the live main output volume on a dial. Each tick moves 1–10%, set separately for the two outputs. Press switches between those outputs. The display shows a live level meter.
- **Route to Mix** switches one output between two mixes.
- **Toggle Mix** routes one output to a mix, and press again restores the previous mix.
- **Mute in Mix** mutes or unmutes one channel inside one mix. A new key starts on System and Chat Mix. The channel name sits at the top of the key and the mix name at the bottom. If that channel is not routed to the mix, the key shows a warning and the press does nothing. Add the route in Wave Link first; the plugin cannot create it.

## Requirements

- Windows 10 or later
- Stream Deck 7.1 or later
- Elgato Wave Link running

## Install

Download `com.matt.better-audio.streamDeckPlugin` from the [1.0.0 release](https://github.com/mon5termatt/plugin-better-audio/releases/tag/v1.0.0) and open it with Stream Deck.

## Development

```bash
npm install
npm test
npm run build
npm run validate
```
