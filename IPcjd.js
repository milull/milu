/*
 * IPPure - 节点 IP 纯净度 & 智能动态隐藏流媒体/AI检测
 * Egern Widget (稳定版 - 大号已重构为卡片式布局)
 *
 * 数据源：https://my.ippure.com/v1/info
 */

const API_URL = 'https://my.ippure.com/v1/info'

// 颜色定义
const COLORS = {
  bg: { light: '#F6F8FA', dark: '#0D1117' },
  card: { light: '#FFFFFF', dark: '#161B22' },
  text: { light: '#24292F', dark: '#F0F6FC' },
  muted: { light: '#57606A', dark: '#8B949E' },
  faint: { light: '#6E7781', dark: '#6E7681' },
  icon: { light: '#6E7781', dark: '#8E8E93' },
  hairline: { light: '#D0D7DE', dark: '#30363D' },
  darkGreen: { light: '#1A7F37', dark: '#30D158' },
  lightGreen: { light: '#2DA44E', dark: '#34C759' },
  amber: { light: '#9A6700', dark: '#FF9F0A' },
  red: { light: '#CF222E', dark: '#FF453A' },
  gray: { light: '#6E7781', dark: '#8E8E93' },
  greenSoft: { light: '#DAFBE1', dark: '#30D15822' },
  amberSoft: { light: '#FFF8C5', dark: '#FF9F0A22' },
  redSoft: { light: '#FFEBE9', dark: '#FF453A22' },
  graySoft: { light: '#F6F8FA', dark: '#8E8E9322' },
}

export default async function(ctx) {
  const env = ctx.env || {}
  const family = ctx.widgetFamily || 'systemMedium'
  const markIP = String(env.MARK_IP || 'true').toLowerCase() === 'true'
  const refreshMinutes = readNumber(env.REFRESH_MINUTES, 10)
  const title = env.LABEL || 'IP PURITY'

  let data
  let ipV4 = '-'
  let ipV6 = '-'

  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'

  async function testService(url, options = {}) {
    const start = Date.now()
    try {
      const resp = await ctx.http.get(url, { timeout: 3500, headers: { 'User-Agent': ua }, ...options })
      return { resp, delay: Date.now() - start, error: false }
    } catch (e) {
      return { resp: null, delay: Date.now() - start, error: true }
    }
  }

  // 并行检测所有服务 + IPPure API
  const [respObj, nf, yt, sp, gpt, claude, gemini, disney, grok] = await Promise.all([
    ctx.http.get(API_URL, { timeout: 5000 }).then(r => ({ r, err: false })).catch(() => ({ r: null, err: true })),
    testService('https://www.netflix.com/title/70143836'),
    testService('https://www.youtube.com/premium'),
    testService('https://www.spotify.com/'),
    testService('https://chatgpt.com'),
    testService('https://claude.ai/login'),
    testService('https://gemini.google.com'),
    testService('https://www.disneyplus.com'),
    testService('https://grok.x.ai')
  ])

  if (respObj.err || !respObj.r) {
    return errorWidget(title, '基础网络请求失败', '无法连接至 IPPure 接口', refreshMinutes)
  }

  try {
    data = await respObj.r.json()
  } catch(e) {
    return errorWidget(title, '解析失败', '接口数据解析错误', refreshMinutes)
  }

  // ---- 预先处理 Netflix 响应（异步解析） ----
  let netflixStatus = '失败'
  if (!nf.error && nf.resp) {
    if (nf.resp.status === 403) {
      netflixStatus = '封禁'
    } else if (nf.resp.status < 400) {
      try {
        const txt = typeof nf.resp.text === 'function' ? await nf.resp.text() : String(nf.resp.body || '')
        netflixStatus = txt.includes('title/80018499') ? '自制' : '完整'
      } catch {
        netflixStatus = '失败'
      }
    } else {
      netflixStatus = '失败'
    }
  }

  const services = [
    getServiceStatus('Netflix', nf, () => netflixStatus),
    getServiceStatus('YouTube', yt, () => (yt.resp && yt.resp.status < 400) ? '解锁' : '失败'),
    getServiceStatus('Spotify', sp, () => (sp.resp && sp.resp.status < 400) ? '解锁' : '失败'),
    getServiceStatus('ChatGPT', gpt, () => (gpt.resp && gpt.resp.status !== 403 && gpt.resp.status !== 429) ? '解锁' : '阻断'),
    getServiceStatus('Claude', claude, () => (claude.resp && claude.resp.status !== 403) ? '解锁' : '阻断'),
    getServiceStatus('Gemini', gemini, () => (gemini.resp && gemini.resp.status !== 403) ? '解锁' : '阻断'),
    getServiceStatus('Disney+', disney, () => (disney.resp && disney.resp.status < 400) ? '解锁' : '失败'),
    getServiceStatus('Grok', grok, () => (grok.resp && grok.resp.status < 400) ? '解锁' : '失败'),
  ]

  const currentIP = data?.ip || ''
  if (currentIP.includes(':')) {
    ipV6 = markIP ? maskIP(currentIP) : currentIP
  } else {
    ipV4 = markIP ? maskIP(currentIP) : currentIP
  }

  const countryCode = data?.countryCode || ''
  const flag = flagEmoji(countryCode)
  const location = compactLocation(data, flag)
  const orgText = data?.asOrganization || ''
  const asnText = data?.asn ? `AS${data.asn}` : '-' 
  
  const risk = extractRisk(data)
  const hasRiskScore = Number.isFinite(risk)
  const displayRisk = hasRiskScore ? risk : 0
  const level = riskLevel(displayRisk)
  const isResidential = Boolean(data?.isResidential)
  const residentialLabel = isResidential ? '住宅' : '机房'
  const residentialColor = isResidential ? COLORS.darkGreen : COLORS.amber
  const display = displayState(displayRisk, isResidential, hasRiskScore)

  // 组合带地区码的位置信息（用于大号组件右上角）
  const locationWithCode = countryCode ? `${flag} ${countryCode} ${data?.city || data?.region || ''}`.trim() : location

  const model = {
    title,
    ipV4,
    ipV6,
    location,
    locationWithCode,
    countryCode: countryCode || '--',
    asnText,
    orgText: truncate(orgText, 12),
    risk: displayRisk,
    hasRiskScore,
    level,
    display,
    isResidential,
    residentialLabel,
    residentialColor,
    refreshMinutes,
    services,
    now: new Date().toISOString(),
  }

  if (family === 'accessoryInline') return inlineWidget(model)
  if (family === 'accessoryCircular') return circularWidget(model)
  if (family === 'accessoryRectangular') return rectangularWidget(model)
  if (family === 'systemSmall') return smallWidget(model)
  if (family === 'systemLarge' || family === 'systemExtraLarge') return largeWidget(model)

  return mediumWidget(model)
}

// ========== 核心：服务状态判断与颜色（灰色0→红色1→橙色2→浅绿3→绿色4） ==========
function getServiceStatus(fullLabel, result, checkDetailFn) {
  if (result.error) {
    return { fullLabel, color: COLORS.gray, statusText: '超时', delayText: '超时', ok: false, priority: 0 }
  }

  const detail = typeof checkDetailFn === 'function' ? checkDetailFn() : '解锁'
  
  if (detail === '封禁' || detail === '失败' || detail === '阻断') {
    return { fullLabel, color: COLORS.gray, statusText: detail, delayText: `${result.delay}ms`, ok: false, priority: 0 }
  }

  const ms = result.delay
  let color = COLORS.darkGreen
  let priority = 4  // 绿色最后
  
  if (ms > 1500) {
    color = COLORS.red
    priority = 1    // 红色第二
  } else if (ms > 700) {
    color = COLORS.amber
    priority = 2    // 橙色第三
  } else if (ms > 300) {
    color = COLORS.lightGreen
    priority = 3    // 浅绿第四
  }

  let statusText = '解锁'
  if (detail === '自制') statusText = '自制'

  return { fullLabel, color, statusText, delayText: `${ms}ms`, ok: true, priority }
}

function errorWidget(title, msg, detail, refreshMinutes) {
  return {
    type: 'widget',
    refreshAfter: nextRefresh(refreshMinutes),
    background: COLORS.bg,
    padding: 14,
    gap: 8,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 7,
        children: [
          { type: 'image', src: 'sf-symbol:network.slash', color: COLORS.red, width: 16, height: 16 },
          { type: 'text', text: title, font: { size: 'subheadline', weight: 'semibold' }, textColor: COLORS.text },
        ],
      },
      { type: 'spacer' },
      { type: 'text', text: msg, font: { size: 'footnote', weight: 'semibold' }, textColor: COLORS.red, maxLines: 1 },
      { type: 'text', text: detail || '-', font: { size: 'caption2' }, textColor: COLORS.muted, maxLines: 2, minScale: 0.75 },
    ],
  }
}

// ========== 中号组件 ==========
function mediumWidget(m) {
  const sortedServices = [...m.services].sort((a, b) => a.priority - b.priority)
  const visibleServices = sortedServices.slice(0, 3)

  return {
    type: 'widget',
    refreshAfter: nextRefresh(m.refreshMinutes),
    background: COLORS.bg,
    padding: 14,
    gap: 0,
    url: 'egern://',
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 8,
        children: [
          { type: 'image', src: `sf-symbol:${m.display.icon}`, color: m.display.color, width: 16, height: 16 },
          { type: 'text', text: m.title, font: { size: 14, weight: 'heavy', family: 'Menlo' }, textColor: COLORS.muted, maxLines: 1 },
          statusBadge(m, 11),
        ],
      },
      { type: 'spacer', length: 4 },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'start',
        gap: 12,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 4,
            flex: 1,
            children: [
              { type: 'text', text: 'RISK SCORE', font: { size: 13, weight: 'semibold', family: 'Menlo' }, textColor: COLORS.faint, maxLines: 1 }, // 放大
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'center',
                gap: 8,
                children: [
                  { type: 'text', text: m.display.value, font: { size: 38, weight: 'black', family: 'Menlo' }, textColor: m.display.color, maxLines: 1, minScale: 0.72 }, // 放大
                  { type: 'text', text: m.display.label, font: { size: 15, weight: 'semibold' }, textColor: COLORS.muted, maxLines: 1 }, // 放大
                ],
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'end',
            gap: 4,
            flex: 1,
            children: [
              compactInfo('位置', m.location, COLORS.text, 12, 13, 180),
              compactInfo('ASN', m.asnText, COLORS.text, 12, 13, 180),
              compactInfo('类型', m.residentialLabel, m.residentialColor, 12, 13, 180),
            ],
          },
        ],
      },
      { type: 'spacer', length: 8 },
      ipLine(m.ipV4 !== '-' ? 'IPv4' : 'IPv6', m.ipV4 !== '-' ? m.ipV4 : m.ipV6, 13, 15),
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        padding: [3, 0],
        children: visibleServices.map(s => ({
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          gap: 3.5,
          children: [
            { type: 'stack', width: 6, height: 6, borderRadius: 3, backgroundColor: s.color },
            { type: 'text', text: s.fullLabel, font: { size: 10, weight: 'bold' }, textColor: COLORS.text },
            { type: 'text', text: s.priority >= 3 ? s.delayText : '', font: { size: 8, family: 'Menlo' }, textColor: s.color }
          ]
        }))
      },
      { type: 'spacer', length: 4 },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        children: [
          { type: 'image', src: 'sf-symbol:clock', color: COLORS.faint, width: 10, height: 10 },
          { type: 'text', text: `每 ${m.refreshMinutes} 分钟刷新`, font: { size: 'caption2' }, textColor: COLORS.faint },
          { type: 'spacer' },
          { type: 'text', text: '更新于 ', font: { size: 'caption2' }, textColor: COLORS.faint },
          { type: 'date', date: m.now, format: 'relative', font: { size: 'caption2' }, textColor: COLORS.faint },
        ],
      },
    ],
  }
}

// ========== 大号组件 ==========
function largeWidget(m) {
  const sortedServices = [...m.services].sort((a, b) => a.priority - b.priority)
  const serviceRows = []
  for (let i = 0; i < sortedServices.length; i += 2) {
    serviceRows.push(sortedServices.slice(i, i + 2))
  }

  return {
    type: 'widget',
    refreshAfter: nextRefresh(m.refreshMinutes),
    background: COLORS.bg,
    padding: 16,
    gap: 0,
    url: 'egern://',
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 8,
        children: [
          { type: 'image', src: `sf-symbol:${m.display.icon}`, color: m.display.color, width: 17, height: 17 },
          { type: 'text', text: m.title, font: { size: 15, weight: 'heavy', family: 'Menlo' }, textColor: COLORS.muted, maxLines: 1 },
          statusBadge(m, 12),
        ],
      },
      { type: 'spacer', length: 6 },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'start',
        gap: 14,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 5,
            flex: 1,
            children: [
              { type: 'text', text: 'RISK SCORE', font: { size: 14, weight: 'semibold', family: 'Menlo' }, textColor: COLORS.faint, maxLines: 1 }, // 放大
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'center',
                gap: 8,
                children: [
                  { type: 'text', text: m.display.value, font: { size: 42, weight: 'black', family: 'Menlo' }, textColor: m.display.color, maxLines: 1, minScale: 0.72 }, // 放大
                  { type: 'text', text: m.display.label, font: { size: 15, weight: 'semibold' }, textColor: COLORS.muted, maxLines: 1 }, // 放大
                ],
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'end',
            gap: 5,
            flex: 1,
            children: [
              compactInfo('位置', m.locationWithCode || m.location, COLORS.text, 13, 14, 180),
              compactInfo('ASN', m.asnText, COLORS.text, 13, 14, 180),
              compactInfo('机构', m.orgText, COLORS.text, 13, 14, 180),
              compactInfo('类型', m.residentialLabel, m.residentialColor, 13, 14, 180),
            ],
          },
        ],
      },
      { type: 'spacer', length: 10 },
      ipLine(m.ipV4 !== '-' ? 'IPv4' : 'IPv6', m.ipV4 !== '-' ? m.ipV4 : m.ipV6, 13, 15),
      { type: 'spacer', length: 12 },
      { type: 'stack', height: 0.5, backgroundColor: COLORS.hairline },
      { type: 'spacer', length: 8 },
      // 服务区域标题
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        children: [
          { type: 'text', text: '服务检测', font: { size: 12, weight: 'semibold', family: 'Menlo' }, textColor: COLORS.muted },
        ],
      },
      { type: 'spacer', length: 6 },
      {
        type: 'stack',
        direction: 'column',
        gap: 8,
        children: serviceRows.map(row => ({
          type: 'stack',
          direction: 'row',
          gap: 12,
          children: row.map(s => serviceCell(s)),
        })),
      },
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        children: [
          { type: 'image', src: 'sf-symbol:clock', color: COLORS.faint, width: 10, height: 10 },
          { type: 'text', text: `每 ${m.refreshMinutes} 分钟刷新`, font: { size: 'caption2' }, textColor: COLORS.faint },
          { type: 'spacer' },
          { type: 'text', text: '更新于 ', font: { size: 'caption2' }, textColor: COLORS.faint },
          { type: 'date', date: m.now, format: 'relative', font: { size: 'caption2' }, textColor: COLORS.faint },
        ],
      },
    ],
  }
}

// ========== 服务单元格：不带地区码 ==========
function serviceCell(s) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    children: [
      { type: 'stack', width: 6, height: 6, borderRadius: 3, backgroundColor: s.color },
      { type: 'text', text: s.fullLabel, font: { size: 11, weight: 'bold' }, textColor: COLORS.text, maxLines: 1, flex: 1 },
      { type: 'text', text: s.statusText, font: { size: 10, weight: 'semibold' }, textColor: s.color, maxLines: 1 },
      { type: 'text', text: s.delayText, font: { size: 9, family: 'Menlo' }, textColor: COLORS.faint, maxLines: 1 },
    ],
  }
}

// ========== 辅助函数 ==========
function inlineWidget(m) { 
  return { 
    type: 'widget', 
    refreshAfter: nextRefresh(m.refreshMinutes), 
    children: [{ 
      type: 'text', 
      text: `${m.countryCode} · ${m.display.shortText} · ${m.ipV4 !== '-' ? m.ipV4 : m.ipV6}`, 
      font: { size: 'caption1', weight: 'semibold' } 
    }] 
  } 
}

function circularWidget(m) { 
  return { 
    type: 'widget', 
    refreshAfter: nextRefresh(m.refreshMinutes), 
    padding: 4, 
    gap: 1, 
    children: [
      { type: 'spacer' }, 
      { type: 'image', src: `sf-symbol:${m.display.icon}`, color: m.display.color, width: 22, height: 22 }, 
      { type: 'text', text: m.display.value, font: { size: 'title3', weight: 'black', family: 'Menlo' }, textColor: m.display.color, textAlign: 'center', maxLines: 1, minScale: 0.75 }, 
      { type: 'text', text: m.display.label, font: { size: 'caption2' }, textColor: COLORS.muted, textAlign: 'center' }, 
      { type: 'spacer' }
    ] 
  } 
}

function rectangularWidget(m) { 
  return { 
    type: 'widget', 
    refreshAfter: nextRefresh(m.refreshMinutes), 
    padding: [3, 8], 
    gap: 3, 
    children: [
      { 
        type: 'stack', 
        direction: 'row', 
        alignItems: 'center', 
        gap: 5, 
        children: [
          { type: 'image', src: `sf-symbol:${m.display.icon}`, color: m.display.color, width: 12, height: 12 }, 
          { type: 'text', text: `${m.countryCode} · ${m.display.label}`, font: { size: 11, weight: 'semibold' }, textColor: m.display.color, maxLines: 1 }, 
          { type: 'spacer' }, 
          { type: 'text', text: m.display.value, font: { size: 11, weight: 'bold', family: 'Menlo' }, textColor: m.display.color }
        ] 
      }, 
      { type: 'text', text: m.ipV4 !== '-' ? `v4: ${m.ipV4}` : `v6: ${m.ipV6}`, font: { size: 12, weight: 'semibold', family: 'Menlo' }, textColor: COLORS.text, maxLines: 1, minScale: 0.65 }, 
      { type: 'text', text: `${m.asnText}`, font: { size: 10 }, textColor: COLORS.muted, maxLines: 1, minScale: 0.75 }
    ] 
  } 
}

function smallWidget(m) { 
  return { 
    type: 'widget', 
    refreshAfter: nextRefresh(m.refreshMinutes), 
    background: COLORS.bg,
    padding: 13, 
    gap: 7, 
    url: 'egern://', 
    children: [
      headerLine(m.title, m.display), 
      { 
        type: 'stack', 
        direction: 'row', 
        alignItems: 'center', 
        children: [
          { type: 'text', text: m.countryCode, font: { size: 'title3', weight: 'bold', family: 'Menlo' }, textColor: COLORS.text }, 
          { type: 'spacer' }, 
          { 
            type: 'stack', 
            direction: 'column', 
            alignItems: 'end', 
            gap: 0, 
            children: [
              { type: 'text', text: m.display.value, font: { size: 'title', weight: 'black', family: 'Menlo' }, textColor: m.display.color }, 
              { type: 'text', text: m.display.label, font: { size: 'caption2', weight: 'semibold' }, textColor: m.display.color }
            ] 
          } 
        ] 
      }, 
      capsule(m.ipV4 !== '-' ? `v4  ${m.ipV4}` : `v6  ${m.ipV6}`, m.display.soft, COLORS.text), 
      { type: 'spacer' }, 
      { type: 'text', text: m.location, font: { size: 'caption2' }, textColor: COLORS.muted, maxLines: 1 }, 
      { type: 'text', text: `${m.asnText}`, font: { size: 'caption2', family: 'Menlo' }, textColor: COLORS.faint, maxLines: 1, minScale: 0.75 }
    ] 
  } 
}

function headerLine(title, level) { 
  return { 
    type: 'stack', 
    direction: 'row', 
    alignItems: 'center', 
    gap: 6, 
    children: [
      { type: 'image', src: `sf-symbol:${level.icon}`, color: level.color, width: 14, height: 14 }, 
      { type: 'text', text: title, font: { size: 'caption1', weight: 'semibold' }, textColor: COLORS.muted, maxLines: 1 }, 
      { type: 'spacer' }, 
      { 
        type: 'stack', 
        direction: 'row', 
        alignItems: 'center', 
        gap: 4, 
        backgroundColor: level.soft, 
        borderRadius: 5, 
        padding: [2, 6], 
        children: [
          { type: 'stack', width: 6, height: 6, borderRadius: 3, backgroundColor: level.color }, 
          { type: 'text', text: level.label, font: { size: 9, weight: 'semibold' }, textColor: level.color, maxLines: 1 }
        ] 
      } 
    ] 
  } 
}

function statusBadge(m, fontSize = 10) { 
  return { 
    type: 'stack', 
    direction: 'row', 
    alignItems: 'center', 
    gap: 5, 
    backgroundColor: m.display.soft, 
    borderRadius: 6, 
    padding: [2, 8], 
    children: [
      { type: 'stack', width: 6, height: 6, borderRadius: 3, backgroundColor: m.display.color }, 
      { type: 'text', text: badgeText(m), font: { size: fontSize, weight: 'semibold', family: 'Menlo' }, textColor: m.display.color, maxLines: 1 }
    ] 
  } 
}

function badgeText(m) { 
  if (m.risk >= 80) return 'CRITICAL'; 
  if (m.risk >= 70) return 'HIGH RISK'; 
  if (m.risk >= 40) return 'MID RISK'; 
  return 'LOW RISK' 
}

function compactInfo(label, value, color, labelSize = 10, valueSize = 11, width = 170) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 4,
    width: width,
    children: [
      { type: 'text', text: label, font: { size: labelSize, weight: 'medium' }, textColor: COLORS.muted, maxLines: 1, width: 36 },
      { type: 'text', text: value || '-', font: { size: valueSize, weight: 'semibold' }, textColor: color || COLORS.text, flex: 1, maxLines: 1, minScale: 0.7, textAlign: 'left' }
    ]
  }
}

function ipLine(label, val, labelSize = 12, addressSize = 14) { 
  return { 
    type: 'stack', 
    direction: 'row', 
    alignItems: 'center', 
    gap: 8, 
    children: [
      { type: 'image', src: 'sf-symbol:network', color: COLORS.icon, width: 13, height: 13 },
      { type: 'text', text: label, font: { size: labelSize, weight: 'semibold', family: 'Menlo' }, textColor: COLORS.muted, maxLines: 1 },
      { type: 'text', text: val, font: { size: addressSize, weight: 'bold', family: 'Menlo' }, textColor: val === '-' ? COLORS.faint : COLORS.text, flex: 1, maxLines: 1, minScale: 0.6, textAlign: 'right' }
    ] 
  } 
}

function capsule(text, bg, color) { 
  return { 
    type: 'stack', 
    direction: 'row', 
    backgroundColor: bg, 
    borderRadius: 7, 
    borderWidth: 1, 
    borderColor: COLORS.hairline, 
    padding: [5, 7], 
    children: [
      { type: 'text', text, font: { size: 11, weight: 'medium', family: 'Menlo' }, textColor: color, maxLines: 1, minScale: 0.68, flex: 1 }
    ] 
  } 
}

function riskLevel(risk) { 
  if (!Number.isFinite(risk)) return { label: '未知', icon: 'questionmark.circle.fill', color: COLORS.gray, soft: COLORS.graySoft }; 
  if (risk >= 80) return { label: '极高风险', icon: 'exclamationmark.octagon.fill', color: COLORS.red, soft: COLORS.redSoft }; 
  if (risk >= 70) return { label: '高风险', icon: 'exclamationmark.triangle.fill', color: COLORS.amber, soft: COLORS.amberSoft }; 
  if (risk >= 40) return { label: '中等风险', icon: 'exclamationmark.circle.fill', color: COLORS.lightGreen, soft: COLORS.greenSoft }; 
  return { label: '低风险', icon: 'checkmark.seal.fill', color: COLORS.darkGreen, soft: COLORS.greenSoft } 
}

function displayState(risk, isResidential, hasRiskScore) { 
  if (Number.isFinite(risk)) { 
    const level = riskLevel(risk); 
    return { value: riskText(risk), label: level.label, shortText: riskText(risk), icon: level.icon, color: level.color, soft: level.soft, hasScore: hasRiskScore } 
  }; 
  if (isResidential) return { value: '住宅', label: '无评分', shortText: '住宅', icon: 'house.fill', color: COLORS.darkGreen, soft: COLORS.greenSoft, hasScore: false }; 
  return { value: '机房', label: '无评分', shortText: '机房', icon: 'building.2.fill', color: COLORS.amber, soft: COLORS.amberSoft, hasScore: false } 
}

function parseRisk(value) { 
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN; 
  if (value === null || value === undefined || value === '') return NaN; 
  return Number.isFinite(Number(value)) ? Number(value) : NaN 
}

function extractRisk(source) { 
  const paths = ['fraudScore', 'fraud_score', 'riskScore', 'risk_score', 'score', 'risk', 'risk.score', 'risk.value', 'risk.fraudScore', 'risk.fraud_score', 'security.score', 'security.riskScore', 'security.risk_score', 'security.fraudScore', 'security.fraud_score', 'privacy.score', 'privacy.riskScore', 'privacy.fraudScore', 'ip.fraudScore', 'ip.riskScore']; 
  for (const path of paths) { 
    const risk = parseRisk(readPath(source, path)); 
    if (Number.isFinite(risk)) return risk 
  }; 
  return scanRisk(source, 0, false) 
}

function readPath(source, path) { 
  if (!source) return undefined; 
  return path.split('.').reduce((current, key) => (current === null || current === undefined) ? undefined : current[key], source) 
}

function scanRisk(value, depth, inRiskBranch) { 
  if (!value || typeof value !== 'object' || depth > 4) return NaN; 
  for (const [key, child] of Object.entries(value)) { 
    const keyLooksRelevant = /fraud|risk|score/i.test(key); 
    if (keyLooksRelevant || inRiskBranch) { 
      const direct = parseRisk(child); 
      if (Number.isFinite(direct)) return direct 
    }; 
    if (child && typeof child === 'object') { 
      const nested = scanRisk(child, depth + 1, inRiskBranch || keyLooksRelevant); 
      if (Number.isFinite(nested)) return nested 
    } 
  }; 
  return NaN 
}

function riskText(risk) { 
  return Number.isFinite(risk) ? String(Math.round(risk)) : '--' 
}

function compactLocation(source, flag) { 
  const city = source?.city || source?.region || source?.state || ''; 
  return city ? [flag, city].join(' ') : (source?.countryCode ? [flag, source.countryCode].join(' ') : flag || '-') 
}

function maskIP(ip) { 
  if (!ip) return '-'; 
  if (ip.includes('.')) { 
    const parts = ip.split('.'); 
    return parts.length >= 4 ? `${parts[0]}.${parts[1]}.••••.${parts[3]}` : ip 
  }; 
  const parts = ip.split(':').filter(Boolean); 
  return parts.length >= 3 ? `${parts[0]}:${parts[1]}:••••:${parts[parts.length - 1]}` : '••••' 
}

function flagEmoji(code) { 
  if (!code || code.length !== 2) return '🌐'; 
  return String.fromCodePoint(...code.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0))) 
}

function truncate(value, maxLen) { 
  const text = value ? String(value) : '-'; 
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text 
}

function readNumber(value, fallback) { 
  const parsed = Number(value); 
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback 
}

function nextRefresh(minutes) { 
  return new Date(Date.now() + minutes * 60 * 1000).toISOString() 
}