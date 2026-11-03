import type { Lang } from '@antler/alert-ui'

// B-0 と B-1 の固定文言（4 言語。zh は繁体字）。AlertState の文言は @antler/alert-ui が持つ。
// 全キー・全言語が空でないことをテストで確かめる（付録 A #9）。zh・ko はネイティブ確認が保留（alert-ui と同じ）。

export type ConnectText = {
  title: string
  linkTitle: string
  linkOpen: string
  linkConnecting: string
  linkClosed: string
  band: string
  cameraTitle: string
  rateLabel: string
  delayLabel: string
  volumeTitle: string
  volumeGuide: string
  previewTitle: string
  previewSafe: string
  previewZone: string
  previewDanger: string
  locationTitle: string
  locationPrompt: string
  locationGranted: string
  locationDenied: string
  locationUnknown: string
  locationInsecure: string
  depart: string
  departNote: string
  noSound: string
  noLocation: string
}

export const CONNECT_TEXT: Record<Lang, ConnectText> = {
  ja: {
    title: 'EZO ROAD 鹿アラート',
    linkTitle: '車載との接続',
    linkOpen: 'つながっています',
    linkConnecting: '接続しています',
    linkClosed: '未接続',
    band: '未接続',
    cameraTitle: 'カメラの受信',
    rateLabel: '受信/秒',
    delayLabel: '遅延 ms',
    volumeTitle: '音量',
    volumeGuide: 'スマホの音量を最大にしてください',
    previewTitle: '3 つの表示',
    previewSafe: 'ゾーン外',
    previewZone: 'ゾーン内',
    previewDanger: '鹿検知',
    locationTitle: '位置情報',
    locationPrompt: '出発を押すと位置の許可を求めます',
    locationGranted: '位置情報は使えます',
    locationDenied:
      '位置の許可がありません。鹿ゾーンの判定ができないため、琥珀のままです。設定でこのサイトの位置情報を許可してください',
    locationUnknown: '位置の許可の状態を確かめられません。出発を押すと許可を求めます',
    locationInsecure:
      'この接続では位置情報が使えません。鹿ゾーンの判定ができないため、琥珀のままです',
    depart: 'テスト音を鳴らして出発',
    departNote: '車載とつながっていなくても出発できます（鹿の検知は出ません）',
    noSound: '音が出ません',
    noLocation: '位置情報なし',
  },
  en: {
    title: 'EZO ROAD Deer Alert',
    linkTitle: 'Link to the car unit',
    linkOpen: 'Connected',
    linkConnecting: 'Connecting',
    linkClosed: 'Not connected',
    band: 'Not connected',
    cameraTitle: 'Camera feed',
    rateLabel: 'msgs/s',
    delayLabel: 'delay ms',
    volumeTitle: 'Volume',
    volumeGuide: 'Turn the phone volume up to maximum',
    previewTitle: 'The three displays',
    previewSafe: 'Outside zone',
    previewZone: 'In zone',
    previewDanger: 'Deer detected',
    locationTitle: 'Location',
    locationPrompt: 'Location permission is requested when you start',
    locationGranted: 'Location is available',
    locationDenied:
      'Location is not allowed, so deer zones cannot be judged and the screen stays amber. Allow location for this site in settings',
    locationUnknown: 'Cannot check location permission. It is requested when you start',
    locationInsecure:
      'Location is unavailable on this connection, so deer zones cannot be judged and the screen stays amber',
    depart: 'Play test sound and start',
    departNote: 'You can start without the car unit (no deer detection)',
    noSound: 'No sound',
    noLocation: 'No location',
  },
  zh: {
    title: 'EZO ROAD 鹿警示',
    linkTitle: '與車載裝置的連線',
    linkOpen: '已連線',
    linkConnecting: '連線中',
    linkClosed: '未連線',
    band: '未連線',
    cameraTitle: '鏡頭接收',
    rateLabel: '次/秒',
    delayLabel: '延遲 ms',
    volumeTitle: '音量',
    volumeGuide: '請將手機音量調到最大',
    previewTitle: '三種顯示',
    previewSafe: '鹿區外',
    previewZone: '鹿區內',
    previewDanger: '偵測到鹿',
    locationTitle: '定位',
    locationPrompt: '按下出發後會請求定位權限',
    locationGranted: '可使用定位',
    locationDenied: '沒有定位權限，無法判定鹿區，畫面會維持琥珀色。請在設定中允許此網站使用定位',
    locationUnknown: '無法確認定位權限。按下出發後會請求權限',
    locationInsecure: '此連線無法使用定位，無法判定鹿區，畫面會維持琥珀色',
    depart: '播放測試音並出發',
    departNote: '即使未連上車載裝置也能出發（不會偵測到鹿）',
    noSound: '沒有聲音',
    noLocation: '沒有定位',
  },
  ko: {
    title: 'EZO ROAD 사슴 경보',
    linkTitle: '차량 장치 연결',
    linkOpen: '연결됨',
    linkConnecting: '연결 중',
    linkClosed: '연결 안 됨',
    band: '연결 안 됨',
    cameraTitle: '카메라 수신',
    rateLabel: '회/초',
    delayLabel: '지연 ms',
    volumeTitle: '음량',
    volumeGuide: '휴대폰 음량을 최대로 올려 주세요',
    previewTitle: '세 가지 표시',
    previewSafe: '구역 밖',
    previewZone: '구역 안',
    previewDanger: '사슴 감지',
    locationTitle: '위치',
    locationPrompt: '출발을 누르면 위치 권한을 요청합니다',
    locationGranted: '위치를 사용할 수 있습니다',
    locationDenied:
      '위치 권한이 없어 사슴 구역을 판정할 수 없고 화면이 호박색으로 유지됩니다. 설정에서 이 사이트의 위치를 허용해 주세요',
    locationUnknown: '위치 권한을 확인할 수 없습니다. 출발을 누르면 권한을 요청합니다',
    locationInsecure:
      '이 연결에서는 위치를 사용할 수 없어 사슴 구역을 판정할 수 없고 화면이 호박색으로 유지됩니다',
    depart: '테스트음 재생 후 출발',
    departNote: '차량 장치에 연결되지 않아도 출발할 수 있습니다 (사슴 감지는 표시되지 않음)',
    noSound: '소리가 나지 않습니다',
    noLocation: '위치 없음',
  },
}
