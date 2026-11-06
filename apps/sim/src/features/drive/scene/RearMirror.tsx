import { useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import { PerspectiveCamera } from 'three'
import { CAMERA_FAR_M } from './layout'
import {
  MIRROR_CENTER,
  MIRROR_PITCH_RAD,
  MIRROR_SIZE_M,
  MIRROR_YAW_RAD,
  buildMirrorFace,
} from './cabin-models'
import { PRIORITY } from './frame-state'

// ルームミラー（drive-tune R5）。車の後ろ（屋根の後ろの端）から真後ろを見る別のカメラで、小さな描画先に
// 15 fps で描き、その映像をミラーの面に左右反転して貼る（鏡なので、車の左後ろはミラーの左に映る）。
// カメラは屋根・ドアの枠より後ろに置くので、車内（Cabin）は映らない（層や表示の切り替えは要らない）。
// 性能（R12・ch6）: 描画先は 256 × 72 px、60 fps のとき 4 フレームに 1 回。後ろは道の描画の窓（80 m）まで。

/** 描画先の大きさ（px）。ミラーの面の縦横比（約 3.6）に合わせる */
export const MIRROR_RT_PX: readonly [number, number] = [256, 72]
/** 描く頻度（Hz） */
export const MIRROR_HZ = 15
/** 後ろのカメラ（車の座標、m）と縦の画角（度）。屋根の後ろの端（z 1.05）より後ろ */
const MIRROR_EYE: readonly [number, number, number] = [0, 1.32, 1.1]
const MIRROR_FOV_DEG = 15
/** 少し下を見る（rad。後ろの道が下半分に入るように） */
const MIRROR_LOOK_DOWN_RAD = 0.05
/** 60 fps で 4 フレームに 1 回になるよう、足し算の丸めのぶんの余裕（s） */
const SLACK_S = 0.002

export function RearMirror() {
  const camera = useMemo(() => {
    const cam = new PerspectiveCamera(
      MIRROR_FOV_DEG,
      MIRROR_SIZE_M[0] / MIRROR_SIZE_M[1],
      0.1,
      // 空の球（Atmosphere、半径は far の 0.8 倍）まで届くように本体と同じ far
      CAMERA_FAR_M,
    )
    cam.name = 'rear-mirror-camera'
    cam.position.set(...MIRROR_EYE)
    // 真後ろ（車の +Z）を向く。YXZ: 先に下へ傾け、それから 180° 回す
    cam.rotation.set(-MIRROR_LOOK_DOWN_RAD, Math.PI, 0, 'YXZ')
    return cam
  }, [])
  // 描画先（drei の useFBO は外れるときに捨てる）。描画先にはトーンマップ前の線形の値が入るので、drei の既定の
  // 16 bit（HalfFloat）のままにする（8 bit だと夜の暗い階調が数段に潰れて、ミラーのフォグに縞が出る）。
  // 深さはレンダーバッファ（深さのテクスチャは作らない）
  const target = useFBO(MIRROR_RT_PX[0], MIRROR_RT_PX[1], { generateMipmaps: false })
  // 鏡の左右反転は面の UV でする（buildMirrorFace）
  const face = useMemo(() => buildMirrorFace(), [])
  // 前に描いてから経った実時間（s）。最初のフレームで必ず描く
  const since = useRef(Infinity)
  // 描画先へ描けるのは、文脈がフレームバッファを作れるときだけ（ブラウザの WebGL2 では必ず作れる。
  // @react-three/test-renderer の偽の文脈は作れないので、そのときは描かずに組み立てだけ）
  const gl = useThree((s) => s.gl)
  const live = useMemo(() => {
    const ctx = gl.getContext()
    const fb: unknown = ctx.createFramebuffer()
    if (typeof fb !== 'object' || fb === null) return false
    ctx.deleteFramebuffer(fb as WebGLFramebuffer)
    return true
  }, [gl])

  useFrame(({ scene }, delta) => {
    if (!live) return
    since.current += delta
    if (since.current < 1 / MIRROR_HZ - SLACK_S) return
    since.current = 0
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(target)
    gl.render(scene, camera)
    // 開発中だけ、ミラーの 1 回の描画コール数・三角形数を出す（performance-analyzer が読む）
    if (import.meta.env.DEV)
      Object.assign(globalThis, {
        __antlerMirrorRenderInfo: {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
        },
      })
    gl.setRenderTarget(prev)
  }, PRIORITY.mirror)

  return (
    <>
      <primitive object={camera} />
      <mesh
        name="rear-mirror"
        geometry={face}
        position={[...MIRROR_CENTER]}
        rotation={[MIRROR_PITCH_RAD, MIRROR_YAW_RAD, 0]}
        rotation-order="YXZ"
      >
        {/* 描画先はトーンマップ前の値なので、toneMapped のまま貼ると本体の画面と同じ色になる */}
        <meshBasicMaterial map={target.texture} fog={false} />
      </mesh>
    </>
  )
}
