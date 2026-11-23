// 네이티브(Capacitor) 기능 래퍼. 웹에서는 조용히 no-op 하거나 웹 대체 API 사용.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { KeepAwake } from '@capacitor-community/keep-awake';

export const isNative = Capacitor.isNativePlatform();

const BAKE_NOTIFICATION_ID = 1;

export async function hapticTick(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* 웹 미지원 무시 */
  }
}

export async function hapticThud(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    /* 웹 미지원 무시 */
  }
}

export async function keepScreenAwake(on: boolean): Promise<void> {
  try {
    if (on) await KeepAwake.keepAwake();
    else await KeepAwake.allowSleep();
  } catch {
    /* 웹 wakeLock 미지원 브라우저 무시 */
  }
}

export async function scheduleBakeDoneNotification(
  atMs: number,
  breadName: string,
): Promise<void> {
  if (!isNative) return;
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: BAKE_NOTIFICATION_ID,
          title: '딩! 🍞',
          body: `${breadName}이(가) 다 구워졌어요. 오븐을 열어보세요.`,
          schedule: { at: new Date(atMs) },
        },
      ],
    });
  } catch {
    /* 권한 거부 등 무시 — 알림은 선택 기능 */
  }
}

export async function cancelBakeNotification(): Promise<void> {
  if (!isNative) return;
  try {
    await LocalNotifications.cancel({
      notifications: [{ id: BAKE_NOTIFICATION_ID }],
    });
  } catch {
    /* 무시 */
  }
}
