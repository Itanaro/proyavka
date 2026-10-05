# Проявка для ПК (Electron)

Своё окно для Windows: загружает https://itanaro.github.io/proyavka/?pc=1, при старте поднимает мост
(`..\proyavka-bridge\bridge.py` через Python из портативного SD), доверяет только сертификату моста на 127.0.0.1:7861.

Сборка (из Linux): `npx @electron/packager . Proyavka --platform=win32 --arch=x64 --electron-version=44.5.1`,
затем положить `icon.ico` рядом с `Proyavka.exe`. Установлено на ПК в `D:\stable-diffusion-portable-main\proyavka-app`,
ярлык «Проявка» на рабочем столе. F5 — обновить, F11 — во весь экран, F12 — инструменты разработчика.
