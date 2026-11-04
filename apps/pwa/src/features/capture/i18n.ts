import type { Lang } from '@antler/alert-ui'

// 走行後の同意画面の固定文言（4 言語。zh は繁体字）。全キー・全言語が空でないことをテストで確かめる（付録 A #9）。
// {n} {m} {done} {total} は fill() で置き換える。*Aria は見えている文言を含める（WCAG 2.5.3）。
// zh・ko はネイティブ確認が保留（connect・alert-ui と同じ）。

export type CaptureText = {
  title: string
  noteAnon: string
  noteScene: string
  notePlace: string
  noteNoChange: string
  noteErase: string
  thumbsLabel: string
  thumbAlt: string
  consentLabel: string
  send: string
  sendAria: string
  decline: string
  declineAria: string
  later: string
  laterAria: string
  sending: string
  progress: string
  waiting: string
  doneProvided: string
  doneDeclined: string
  close: string
  stopNetwork: string
  stopBusy: string
  stopMisconfigured: string
  stopEdge: string
  retry: string
}

export const CAPTURE_TEXT: Record<Lang, CaptureText> = {
  ja: {
    title: '未送信の検知フレーム {n} 件',
    noteAnon: '匿名で提供します。氏名や端末の情報は送りません',
    noteScene: '画像に写るのは前方の道路のようすだけで、車内は写しません',
    notePlace: '位置は道路の区間に丸めて送ります',
    noteNoChange: '提供しなくても、通知はこれまでと変わりません',
    noteErase: '「提供しない」を選ぶと、この機器からも消えます',
    thumbsLabel: '送る画像（最大 6 枚）',
    thumbAlt: '検知フレーム',
    consentLabel: '提供する（匿名）',
    send: '送る',
    sendAria: '検知フレーム {n} 件を提供して送る',
    decline: '提供しない',
    declineAria: '検知フレーム {n} 件を提供しない（この機器から消す）',
    later: 'あとで',
    laterAria: 'あとで決める（何も変えずに閉じる）',
    sending: '送っています',
    progress: '{done} / {total}',
    waiting: '混み合っているため、少し待っています',
    doneProvided: '{n} 件を提供しました（失敗 {m} 件）',
    doneDeclined: '{n} 件をこの機器から消しました',
    close: '閉じる',
    stopNetwork: '回線がつながったら、もう一度送ってください',
    stopBusy: '混み合っています。しばらくしてからもう一度',
    stopMisconfigured: '送り先に届きませんでした',
    stopEdge: '車載とつながりません。つながってからもう一度',
    retry: 'もう一度',
  },
  en: {
    title: 'Unsent detection frames: {n}',
    noteAnon: 'Shared anonymously. No name or device information is sent',
    noteScene: 'Images show only the road ahead. The cabin is never recorded',
    notePlace: 'Location is rounded to a road segment',
    noteNoChange: 'Alerts work the same whether or not you share',
    noteErase: 'If you choose "Do not share", the frames are also deleted from this unit',
    thumbsLabel: 'Images to send (up to 6)',
    thumbAlt: 'Detection frame',
    consentLabel: 'Share (anonymous)',
    send: 'Send',
    sendAria: 'Share and send {n} detection frames',
    decline: 'Do not share',
    declineAria: 'Do not share {n} detection frames (delete them from this unit)',
    later: 'Later',
    laterAria: 'Decide later (close without changing anything)',
    sending: 'Sending',
    progress: '{done} / {total}',
    waiting: 'The server is busy. Waiting a moment',
    doneProvided: 'Shared {n} frames ({m} failed)',
    doneDeclined: 'Deleted {n} frames from this unit',
    close: 'Close',
    stopNetwork: 'Please send again when you have a connection',
    stopBusy: 'The server is busy. Please try again later',
    stopMisconfigured: 'Could not reach the destination',
    stopEdge: 'Cannot reach the car unit. Try again once connected',
    retry: 'Try again',
  },
  zh: {
    title: '尚未傳送的偵測影格 {n} 張',
    noteAnon: '以匿名方式提供，不會傳送姓名或裝置資訊',
    noteScene: '影像只拍到前方道路的情況，不會拍到車內',
    notePlace: '位置會歸納為道路區段後再傳送',
    noteNoChange: '即使不提供，通知功能也不會改變',
    noteErase: '選擇「不提供」後，也會從此裝置中刪除',
    thumbsLabel: '要傳送的影像（最多 6 張）',
    thumbAlt: '偵測影格',
    consentLabel: '提供（匿名）',
    send: '傳送',
    sendAria: '提供並傳送 {n} 張偵測影格',
    decline: '不提供',
    declineAria: '不提供 {n} 張偵測影格（從此裝置刪除）',
    later: '稍後',
    laterAria: '稍後再決定（不做任何變更並關閉）',
    sending: '傳送中',
    progress: '{done} / {total}',
    waiting: '目前較為擁擠，請稍候',
    doneProvided: '已提供 {n} 張（失敗 {m} 張）',
    doneDeclined: '已從此裝置刪除 {n} 張',
    close: '關閉',
    stopNetwork: '網路連線後，請再傳送一次',
    stopBusy: '目前較為擁擠，請稍後再試',
    stopMisconfigured: '無法送達傳送目的地',
    stopEdge: '無法連上車載裝置，連上後請再試一次',
    retry: '再試一次',
  },
  ko: {
    title: '미전송 감지 프레임 {n}장',
    noteAnon: '익명으로 제공하며 이름이나 기기 정보는 보내지 않습니다',
    noteScene: '이미지에는 앞쪽 도로 모습만 담기며 차 안은 찍지 않습니다',
    notePlace: '위치는 도로 구간으로 뭉뚱그려 보냅니다',
    noteNoChange: '제공하지 않아도 알림은 그대로 작동합니다',
    noteErase: '"제공 안 함"을 선택하면 이 기기에서도 삭제됩니다',
    thumbsLabel: '보낼 이미지 (최대 6장)',
    thumbAlt: '감지 프레임',
    consentLabel: '제공 (익명)',
    send: '보내기',
    sendAria: '감지 프레임 {n}장을 제공하고 보내기',
    decline: '제공 안 함',
    declineAria: '감지 프레임 {n}장 제공 안 함 (이 기기에서 삭제)',
    later: '나중에',
    laterAria: '나중에 결정 (변경 없이 닫기)',
    sending: '보내는 중',
    progress: '{done} / {total}',
    waiting: '혼잡하여 잠시 기다리는 중입니다',
    doneProvided: '{n}장을 제공했습니다 (실패 {m}장)',
    doneDeclined: '이 기기에서 {n}장을 삭제했습니다',
    close: '닫기',
    stopNetwork: '네트워크에 연결되면 다시 보내 주세요',
    stopBusy: '혼잡합니다. 잠시 후 다시 시도해 주세요',
    stopMisconfigured: '전송 대상에 도달하지 못했습니다',
    stopEdge: '차량 장치에 연결할 수 없습니다. 연결 후 다시 시도해 주세요',
    retry: '다시 시도',
  },
}

/** {name} を値で置き換える。足りない名前はそのまま残す。 */
export function fill(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name]
    return value === undefined ? whole : String(value)
  })
}
