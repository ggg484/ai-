#!/usr/bin/env python3
"""自生成音效（CC0/自有）：用 Python 合成 WAV，再用 ffmpeg 转 .ogg。
不下载任何外部素材，运行时零外部请求。
"""
import math, os, random, struct, subprocess, sys, wave

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else 'assets/audio/sfx'
TMP = '/tmp/sfxwav'
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
random.seed(7)


def lowpass(buf, a):
    out, y = [], 0.0
    for x in buf:
        y += a * (x - y)
        out.append(y)
    return out


def highpass(buf, a):
    lp = lowpass(buf, a)
    return [x - l for x, l in zip(buf, lp)]


def noise(dur, a=0.2):
    return [random.uniform(-1, 1) for _ in range(int(SR * dur))]


def env(buf, attack=0.002, decay=None):
    n = len(buf)
    out = []
    for i, x in enumerate(buf):
        t = i / SR
        e = min(1.0, t / attack) if attack > 0 else 1.0
        if decay:
            e *= math.exp(-t / decay)
        out.append(x * e)
    return out


def tone(f0, dur, f1=None, kind='sine', decay=None):
    n = int(SR * dur)
    out = []
    ph = 0.0
    for i in range(n):
        t = i / SR
        f = f0 if f1 is None else f0 + (f1 - f0) * (t / dur)
        ph += 2 * math.pi * f / SR
        if kind == 'sine':
            v = math.sin(ph)
        elif kind == 'square':
            v = 1.0 if math.sin(ph) > 0 else -1.0
        elif kind == 'saw':
            v = ((ph / (2 * math.pi)) % 1.0) * 2 - 1
        else:
            v = math.sin(ph)
        out.append(v)
    return env(out, 0.001, decay)


def mix(*layers):
    n = max(len(l) for l in layers)
    out = [0.0] * n
    for l in layers:
        for i, v in enumerate(l):
            out[i] += v
    peak = max(0.0001, max(abs(v) for v in out))
    return [v / peak * 0.9 for v in out]


def delay(buf, seconds):
    return [0.0] * int(SR * seconds) + list(buf)


def save(name, samples):
    path = os.path.join(TMP, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in samples:
            frames += struct.pack('<h', int(max(-1.0, min(1.0, v)) * 32000))
        w.writeframes(bytes(frames))
    ogg = os.path.join(OUT, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path,
                    '-c:a', 'libvorbis', '-q:a', '2', '-ar', '44100', '-ac', '1', ogg], check=True)
    print('  %-14s %6d B' % (name + '.ogg', os.path.getsize(ogg)))


# 步枪：噪声爆 + 低频砰
save('shot_rifle', mix(
    env(lowpass(noise(0.22, 0.45), 0.55), 0.0005, 0.045),
    tone(110, 0.14, 48, 'triangle', 0.05),
    tone(1600, 0.02, 400, 'square', 0.008)))
# 手枪：更短更亮
save('shot_pistol', mix(
    env(highpass(noise(0.14, 0.6), 0.25), 0.0004, 0.03),
    tone(170, 0.09, 70, 'square', 0.03)))
# 命中
save('hit', mix(
    tone(1300, 0.05, None, 'square', 0.018),
    env(lowpass(noise(0.05, 0.3), 0.5), 0.0005, 0.012)))
# 爆头
save('headshot', mix(
    tone(1900, 0.09, 1400, 'sine', 0.035),
    env(highpass(noise(0.06, 0.5), 0.3), 0.0004, 0.014)))
# 换弹：两声机械咔哒
save('reload', mix(
    tone(380, 0.04, None, 'square', 0.012),
    delay(tone(520, 0.05, None, 'square', 0.014), 0.18),
    env(lowpass(noise(0.05, 0.6), 0.6), 0.0003, 0.008)))
# 空仓
save('empty', mix(tone(720, 0.03, None, 'square', 0.008)))
# 脚步
save('step', env(lowpass(noise(0.06, 0.35), 0.18), 0.002, 0.02))
# 提示音
save('beep', tone(1180, 0.07, None, 'square', 0.03))
# 下包
save('plant', tone(420, 0.18, 760, 'saw', 0.09))
# 爆炸
save('explode', mix(
    env(lowpass(noise(0.95, 0.5), 0.22), 0.002, 0.3),
    tone(72, 0.7, 30, 'sine', 0.3)))
# 胜利 / 失败
save('win', mix(
    tone(523, 0.12, None, 'sine', 0.06),
    delay(tone(784, 0.18, None, 'sine', 0.09), 0.12)))
save('lose', mix(
    tone(320, 0.14, None, 'triangle', 0.07),
    delay(tone(220, 0.22, None, 'triangle', 0.11), 0.14)))
print('done ->', OUT)
