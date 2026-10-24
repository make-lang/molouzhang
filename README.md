# 末日楼长

停电第三天，你被推举为这栋老公寓的楼长。电台说救援一个月内会到，前提是你们撑得到那时候。

一个回合制、横版像素风的末日街区避难所经营小游戏。玩法骨架参考 Rebuild 2：派住户搜刮、清理、收复、拆楼、守边界，撑过 30 夜，或者收复电台叫来救援。

## 直接玩

双击 `dist/index.html`，用浏览器打开就行。进度自动存在浏览器里。

## 开发

```bash
npm install
pip install -r requirements.txt
npm run build      # 生成 dist/index.html
npm run smoke      # 冒烟测试
npm run balance    # 脚本批量对局，看胜率
```

逻辑在 `src/sim.js`，界面在 `src/index.src.html`。更详细的架构和设计约定见 `CLAUDE.md`。

## 字体

界面使用 [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（SIL Open Font License 1.1），构建时只取用到的字形内嵌进页面。许可证见 `LICENSE-FONT.txt`。
