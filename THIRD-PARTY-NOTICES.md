# Third-party source

Window capture is adapted from the local GamePilot/UI-TARS Desktop prototype (`apps/ui-tars/src/main/game/windows/WindowStream.ts`) preserved at `gamepilot-baseline-2026-10-12`. The adaptation adds native status queries, source-frame barriers, session generations and explicit timestamps. UI-TARS Desktop upstream: https://github.com/bytedance/UI-TARS-desktop. Its Apache License 2.0 is retained in licenses/UI-TARS-desktop-Apache-2.0.txt. The original files are preserved in the baseline repository.

The Python input validation and vgamepad adapter are adapted from that same baseline's `apps/ui-tars/src/main/game/gamepad/gamepad_service.py`. The new protocol adds lease generations, bounded queues, a separate output worker and progress/stop acknowledgements. The original baseline remains unchanged; the same Apache-2.0 license copy is retained.

Pi Agent Core / pi-ai / Pi telemetry are bundled from https://github.com/earendil-works/pi at commit `4270522473e677ddba7b093caa0064a3df51d459`. Their source is not modified by this project.

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Installed npm dependencies retain their licenses in node_modules. Installer distribution will require collecting notices for all bundled transitive dependencies; installer packaging is not implemented in this phase. BetterGI and Cradle source is not included.
