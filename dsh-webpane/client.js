/**
 * 右侧栏「网页」面板：同源 iframe + DOM 执行器。
 *
 * 页面由 Host 从 DSH 自己的 origin 托管（/play/...），因此这里的 JS
 * 可以直接读 iframe 的 document、派发点击和输入，不需要任何代理改写。
 *
 * 执行器（SSE 连接）挂在插件作用域而非 React 组件里：侧栏切标签、折叠、
 * 甚至关掉面板，命令通道都不掉；只有真正要执行动作时才确保 iframe 在。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-webpane',
  factory(require) {
    const beacon = (message) => {
      try {
        fetch('/__webpane/log', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message }),
        }).catch(() => {})
      } catch { /* ignore */ }
    }
    beacon('module-loaded')
    const React = require('react')
    const h = React.createElement
    beacon('react-ok')

    const TAB_ID = '@local/dsh-webpane'
    const TAB_KIND = 'webpane'
    const DEFAULT_URL = '/play/?lang=zh_hans'

    /** 每个 session 一份面板状态：sessionId -> { iframe, url }。 */
    const panes = new Map()
    const runtime = { ctx: null }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    /** 把用户的字符串转成可读的一行。 */
    const label = (element) => {
      const text = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
        ? (element.value || element.placeholder || '')
        : (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '')
      return String(text).replace(/\s+/g, ' ').trim().slice(0, 80)
    }

    const refOf = (element) => element.getAttribute('data-dshref') ?? ''

    /** 在指定 session 的面板里执行一条动作。 */
    const runAction = async (frame, action, payload) => {
      const win = frame.contentWindow
      const doc = frame.contentDocument
      if (!win || !doc) throw new Error('面板还没加载完成')

      const waitLoad = () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('页面加载超时')), 15000)
        frame.addEventListener('load', () => { clearTimeout(timer); resolve() }, { once: true })
      })
      const describe = () => ({
        url: win.location.pathname + win.location.search,
        title: doc.title,
        readyState: doc.readyState,
      })
      const resolveElement = (target) => {
        if (typeof target.ref === 'string' && target.ref !== '') {
          const found = doc.querySelector(`[data-dshref="${target.ref}"]`)
          if (found) return found
        }
        if (typeof target.selector === 'string' && target.selector !== '') {
          const found = doc.querySelector(target.selector)
          if (found) return found
          throw new Error(`找不到选择器 ${target.selector}`)
        }
        if (typeof target.text === 'string' && target.text !== '') {
          const candidates = [...doc.querySelectorAll('button, a, [role="button"], [role="gridcell"], [tabindex], input, select, textarea')]
          const found = candidates.find((element) => label(element) === target.text)
            ?? candidates.find((element) => label(element).includes(target.text))
          if (found) return found
          throw new Error(`找不到文本「${target.text}」`)
        }
        throw new Error('需要 ref、selector 或 text 之一')
      }
      const pointer = (element) => {
        element.scrollIntoView({ block: 'center', inline: 'center' })
        const rect = element.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1 }
        element.dispatchEvent(new win.PointerEvent('pointerdown', { ...init, pointerId: 1, isPrimary: true }))
        element.dispatchEvent(new win.MouseEvent('mousedown', init))
        element.dispatchEvent(new win.PointerEvent('pointerup', { ...init, pointerId: 1, isPrimary: true, buttons: 0 }))
        element.dispatchEvent(new win.MouseEvent('mouseup', { ...init, buttons: 0 }))
        element.dispatchEvent(new win.MouseEvent('click', { ...init, buttons: 0 }))
        if (typeof element.click === 'function') element.click()
      }

      switch (action) {
        case 'open': {
          const url = typeof payload.url === 'string' && payload.url !== '' ? payload.url : DEFAULT_URL
          if (win.location.pathname + win.location.search === url) return describe()
          const loaded = waitLoad()
          frame.src = url
          await loaded
          await sleep(600)
          return describe()
        }
        case 'state':
          return describe()
        case 'text': {
          const text = doc.body?.innerText ?? ''
          return text.slice(0, payload.limit ?? 6000)
        }
        case 'snapshot': {
          const nodes = [...doc.querySelectorAll('button, a, [role="button"], [role="gridcell"], [role="tab"], [tabindex], input, select, textarea')]
          const rows = []
          for (const element of nodes) {
            if (rows.length >= 240) break
            const rect = element.getBoundingClientRect()
            if (rect.width === 0 && rect.height === 0) continue
            const ref = `e${rows.length + 1}`
            element.setAttribute('data-dshref', ref)
            const kind = element.getAttribute('role') ?? element.tagName.toLowerCase()
            const value = element.value ? ` value="${String(element.value).slice(0, 40)}"` : ''
            const disabled = element.disabled === true || element.getAttribute('aria-disabled') === 'true' ? ' [disabled]' : ''
            rows.push(`${ref} <${kind}${value}${disabled}> ${label(element)}`)
          }
          const body = (doc.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n')
          const limit = payload.limit ?? 6000
          const header = `${doc.title} — ${win.location.pathname}\n`
          return `${header}\n${rows.join('\n')}\n\n--- text ---\n${body.slice(0, Math.max(1000, limit - rows.join('\n').length))}`
        }
        case 'click': {
          const element = resolveElement(payload)
          const before = describe()
          pointer(element)
          await sleep(500)
          const after = describe()
          return `clicked ${refOf(element) || element.tagName.toLowerCase()} (${label(element)}) → ${after.url}${before.url !== after.url ? ' (navigated)' : ''}`
        }
        case 'type': {
          const element = resolveElement(payload)
          element.focus()
          const text = String(payload.text ?? '')
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable) {
            const proto = element.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            if (setter && element.tagName !== 'DIV' && !element.isContentEditable) setter.call(element, text)
            else element.textContent = text
            element.dispatchEvent(new win.Event('input', { bubbles: true }))
            element.dispatchEvent(new win.Event('change', { bubbles: true }))
          } else {
            element.textContent = text
          }
          if (payload.submit === true) {
            for (const type of ['keydown', 'keyup']) {
              element.dispatchEvent(new win.KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true }))
            }
          }
          return `typed ${text.length} chars into ${refOf(element) || element.tagName.toLowerCase()}`
        }
        case 'press': {
          const target = doc.activeElement ?? doc.body
          for (const type of ['keydown', 'keyup']) {
            target.dispatchEvent(new win.KeyboardEvent(type, { key: String(payload.key ?? ''), bubbles: true }))
          }
          return `pressed ${String(payload.key ?? '')}`
        }
        case 'scroll': {
          win.scrollBy(0, Number(payload.dy ?? 0))
          await sleep(200)
          return `scrollY=${Math.round(win.scrollY)}`
        }
        case 'back': {
          const loaded = waitLoad()
          win.history.back()
          await loaded
          return describe()
        }
        case 'eval': {
          const value = await win.eval(String(payload.code ?? ''))
          if (value === undefined) return 'undefined'
          try {
            return JSON.stringify(value, null, 2).slice(0, payload.limit ?? 6000)
          } catch {
            return String(value).slice(0, payload.limit ?? 6000)
          }
        }
        default:
          throw new Error(`未知动作 ${action}`)
      }
    }

    /** 一个面板标签页：工具栏 + 同源 iframe。 */
    function WebPaneBody(props) {
      const sessionId = props?.sessionId ?? props?.standard?.sessionId ?? 'unknown'
      const holder = React.useRef({ iframe: null, url: DEFAULT_URL })
      const [title, setTitle] = React.useState('Murdoku')
      const [url, setUrl] = React.useState(DEFAULT_URL)
      // 等磁盘快照回填 localStorage 之后再挂 iframe，否则 SPA 会先读到空进度。
      const [ready, setReady] = React.useState(false)

      React.useEffect(() => {
        let cancelled = false
        fetch('/__webpane/progress', { headers: { accept: 'application/json' } })
          .then(response => response.json())
          .then((payload) => {
            const storage = payload?.snapshot?.storage
            if (storage && typeof storage === 'object') {
              for (const [key, value] of Object.entries(storage)) {
                if (typeof value === 'string' && localStorage.getItem(key) === null) localStorage.setItem(key, value)
              }
            }
          })
          .catch(() => {})
          .finally(() => { if (!cancelled) setReady(true) })
        return () => { cancelled = true }
      }, [])

      const setFrame = (element) => {
        holder.current.iframe = element
        if (element) beacon('frame-attach:' + sessionId)
      }

      React.useEffect(() => {
        beacon('body-mount:' + sessionId)
        panes.set(sessionId, holder)
        return () => {
          if (panes.get(sessionId) === holder) panes.delete(sessionId)
        }
      }, [sessionId])

      const refresh = () => {
        const frame = holder.current.iframe
        if (frame) frame.src = frame.src
      }

      const sync = () => {
        const frame = holder.current.iframe
        const doc = frame?.contentDocument
        if (!doc) return
        const current = (doc.location?.pathname ?? '/') + (doc.location?.search ?? '')
        holder.current.url = current
        setUrl(current)
        setTitle(doc.title || 'Murdoku')
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            fontSize: 12, opacity: 0.75, borderBottom: '1px solid rgba(127,127,127,0.25)',
          },
        },
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' } }, url),
        h('button', {
          type: 'button',
          onClick: refresh,
          title: '刷新',
          style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, padding: '0 4px' },
        }, '刷新')),
        ready ? h('iframe', {
          ref: setFrame,
          src: holder.current.url || DEFAULT_URL,
          title: 'Murdoku',
          onLoad: sync,
          style: { flex: 1, width: '100%', border: 0, minHeight: 0, background: '#0e0b13' },
        }) : h('div', { style: { flex: 1, display: 'grid', placeItems: 'center', fontSize: 12, opacity: 0.5 } }, '载入本地进度…'))
    }

    return {
      inject: ['slots', 'sidebarRight', 'sidebarRightTabs', 'uiSession'],
      apply(ctx) {
        try {
          runtime.ctx = ctx

          ctx.effect(() => ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            multiple: false,
            keepMounted: true,
            priority: 'extension',
            title: () => '网页',
            guide: [{
              id: 'murdoku',
              order: 24,
              title: () => '网页 · Murdoku',
              description: () => '本地离线副本；agent 可读取 DOM 并点击',
            }],
          }), 'dsh-webpane: tab type')

          ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            inject: (sessionId) => ({ sessionId }),
          }, WebPaneBody)), 'dsh-webpane: body')

          // 命令通道：随插件存活，不随侧栏标签页挂载/卸载。
          // Host 重载时路由会短暂 404，EventSource 遇非 200 会永久 CLOSED，
          // 所以这里自己管重连，而不是依赖浏览器的自动重试。
          ctx.effect(() => {
            let disposed = false
            let source = null
            const connect = () => {
              if (disposed) return
              const es = new EventSource('/__webpane/panel')
              source = es
              es.onopen = () => beacon('sse-open')
              es.onerror = () => {
                es.close()
                if (source === es) source = null
                if (!disposed) setTimeout(connect, 1500)
              }
              es.addEventListener('open-tab', (event) => {
                try {
                  const wanted = JSON.parse(event.data || '{}').session
                  const current = runtime.ctx?.uiSession?.adapter?.current?.getSnapshot?.()?.key
                  // 只有“当前正在显示这个 session”的页面才开面板，别处绝不弹。
                  if (wanted !== undefined && current !== wanted) return
                  runtime.ctx?.sidebarRight?.openTab(TAB_KIND)
                } catch { /* ignore */ }
              })
              es.addEventListener('command', async (event) => {
                const parsed = JSON.parse(event.data)
                // 指定 session 时只由持有该 session 面板的页面执行；
                // 其它浏览器标签页保持沉默，绝不跨 session 开/操作面板。
                const holderOf = (item) => (item && item.current ? item.current : item)
                const anyPane = [...panes.values()].map(holderOf).find(item => item && item.iframe !== null && item.iframe !== undefined)
                const target = parsed.session === undefined || parsed.session === null
                  ? anyPane
                  : holderOf(panes.get(parsed.session))
                const frame = target && target.iframe ? target.iframe : undefined
                if (frame === undefined || frame === null) return
                let body
                try {
                  const value = await runAction(frame, parsed.action, parsed.payload ?? {})
                  body = { id: parsed.id, ok: true, value }
                } catch (error) {
                  body = { id: parsed.id, ok: false, error: error instanceof Error ? error.message : String(error) }
                }
                fetch('/__webpane/result', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body),
                }).catch(() => {})
              })
            }
            connect()
            return () => { disposed = true; source?.close() }
          }, 'dsh-webpane: executor')

          beacon('apply-ok')
        } catch (error) {
          beacon('apply-error: ' + (error && error.message ? error.message : String(error)))
          throw error
        }
      },
    }
  },
})
