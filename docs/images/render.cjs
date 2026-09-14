// Regenerate the README mockup PNGs from the SVG sources in this folder.
// Dev-only helper (not loaded by the plugin). Requires: npm i @resvg/resvg-js
// and the fonts referenced below (apt: fonts-noto-cjk fonts-jetbrains-mono).
const fs = require('fs')
const path = require('path')
const { Resvg } = require('@resvg/resvg-js')

const FONTS = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
  '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf',
  '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf',
]
for (const name of ['hero', 'languages', 'workflow']) {
  let src = fs.readFileSync(path.join(__dirname, name + '.svg'), 'utf8')
  src = src.split('font-family="Noto Sans SC"').join('font-family="Noto Sans CJK SC"')
  const r = new Resvg(src, { fitTo: { mode: 'zoom', value: 2 }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Noto Sans CJK SC', sansSerifFamily: 'Noto Sans CJK SC', monospaceFamily: 'JetBrains Mono' } })
  fs.writeFileSync(path.join(__dirname, name + '.png'), r.render().asPng())
  console.log('rendered', name + '.png')
}
