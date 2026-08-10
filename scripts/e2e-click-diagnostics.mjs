import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dataHome = mkdtempSync(join(tmpdir(), 'npz-e2e-click-'))
console.log('click-diag data home:', dataHome)

async function run() {
  const repo = process.cwd()
  const app = await electron.launch({ args: [join(repo, 'out', 'main', 'index.js')], cwd: repo, env: { ...process.env, NPZ_E2E_USERDATA: dataHome } })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(1000)
    const result = await win.evaluate(() => {
      const nav = document.querySelector('nav')
      const anchors = nav ? Array.from(nav.querySelectorAll('a')) : []
      const anchorInfo = anchors.map(a => ({ href: a.getAttribute('href'), text: a.innerText }))
      const video = anchors.find(a => /video/i.test(a.innerText) || /video/i.test(a.getAttribute('href') || ''))
      if (!video) return { error: 'no-video-anchor', anchorInfo }
      const r = video.getBoundingClientRect()
      const cx = Math.floor(r.left + r.width/2)
      const cy = Math.floor(r.top + r.height/2)
      const elAtPoint = document.elementFromPoint(cx, cy)
      const elDesc = elAtPoint ? { tag: elAtPoint.tagName, class: elAtPoint.className, id: elAtPoint.id, innerText: elAtPoint.innerText ? elAtPoint.innerText.slice(0,200) : '' } : null
      // perform click
      const beforeHash = window.location.hash
      video.click()
      const afterHash = window.location.hash
      const title = document.title
      const main = document.querySelector('main')
      const mainText = main ? main.innerText.slice(0,1000) : ''
      // capture the first h1 and its ancestor chain up to <body>
      const h1 = main ? main.querySelector('h1') : document.querySelector('h1')
      function ancestorChain(el){
        const chain = []
        let cur = el
        while(cur && cur.tagName && cur.tagName.toLowerCase() !== 'html'){
          chain.push({ tag: cur.tagName, id: cur.id || null, class: cur.className || null })
          cur = cur.parentElement
        }
        return chain
      }
      const h1Text = h1 ? h1.innerText.slice(0,200) : null
      const h1Ancestors = h1 ? ancestorChain(h1) : null
      return { anchorInfo, cx, cy, elDesc, beforeHash, afterHash, title, mainText, h1Text, h1Ancestors }
    })
    const file = join(dataHome, 'click-diag.json')
    writeFileSync(file, JSON.stringify(result, null, 2))
    console.log('WROTE', file)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await app.close()
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
