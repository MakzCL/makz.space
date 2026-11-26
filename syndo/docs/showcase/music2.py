import numpy as np, wave, sys
SR=44100; DUR=50.0; N=int(SR*DUR); out=np.zeros((N,2))
BPM=120; B=60/BPM
def t_(d): return np.arange(int(SR*d))/SR
def add(sig, at, gain=1.0, pan=0.0):
    i=int(at*SR); j=min(N,i+len(sig)); s=sig[:j-i]*gain
    out[i:j,0]+=s*(1-max(0,pan)); out[i:j,1]+=s*(1+min(0,pan))
def env(n, a=.005, d=.2):
    t=np.arange(n)/SR; return np.minimum(1,t/a)*np.exp(-t/d)
def lp(x, k):
    y=np.zeros_like(x); acc=0.
    for i in range(len(x)): acc+= k*(x[i]-acc); y[i]=acc
    return y
def kick():
    t=t_(.45); f=50+120*np.exp(-t*30); ph=2*np.pi*np.cumsum(f)/SR; return np.sin(ph)*np.exp(-t*7)*1.0
def clap():
    t=t_(.25); n=np.random.randn(len(t)); e=np.exp(-t*18)*(1+.6*np.exp(-((t-.012)*300)**2)); return lp(n,.5)*e*.35
def hat(o=False):
    t=t_(.25 if o else .06); n=np.random.randn(len(t)); n=n-lp(n,.25); return n*np.exp(-t*(12 if o else 60))*.12
def saw(f, d, det=(-.12,0,.12)):
    t=t_(d); s=sum(2*((t*f*2**(c/12))%1)-1 for c in det)/len(det); return s
def note(m): return 440*2**((m-69)/12)
prog=[(57,[57,60,64]),(53,[53,57,60]),(48,[48,52,55]),(55,[55,59,62])] # Am F C G
def pad(chord, d, cutoff=.04):
    s=sum(saw(note(m+12), d, (-.15,-.05,.05,.15)) for m in chord)/3
    s=lp(s,cutoff); e=np.minimum(1,t_(d)/.4)*np.minimum(1,(d-t_(d))/.4); return s*e*.22
def bass(m, d): s=saw(note(m-12), d, (0,)); s=lp(s,.08); return s*env(len(s),.004,.18)*.45
def riser(d):
    t=t_(d); n=np.random.randn(len(t)); k=(t/d)**2; y=np.zeros_like(n); acc=0.
    for i in range(len(n)): acc+=(.02+.5*k[i])*(n[i]-acc); y[i]=acc
    return y*k*.25
def impact():
    t=t_(2.2); return (np.sin(2*np.pi*45*t)*np.exp(-t*2.2)*.9 + lp(np.random.randn(len(t)),.3)*np.exp(-t*5)*.3)

import json
tl=json.load(open(sys.argv[2])); TOT=tl[-1]['end']
DUR=TOT; N=int(SR*DUR); out=np.zeros((N,2))
cut=[x['start'] for x in tl][1:]
free_s=[x for x in tl if x['key']=='free'][0]; end_s=[x for x in tl if x['key']=='end'][0]
# intro: pad + riser into the first scene
for bar in range(3): add(pad(prog[bar%4][1], 2.0, .02), bar*2, .9)
add(riser(5.0), 0.4, .7)
for c in cut: add(impact(), c, .32)
# groove under the narration: kick on 1 and 3, soft hats, bass, pad, arp (sparse so the voice sits on top)
g0=5.54; g1=free_s['start']
i=0
while g0+i*B < g1:
    at=g0+i*B
    if i%2==0: add(kick(), at, .55)
    if i%4==2: add(clap(), at, .45, .1)
    add(hat(), at+B/2, .45, -.2)
    bar=int((at-g0)//2)%4; root,ch=prog[bar]
    add(bass(root, B/2*.95), at, .55)
    i+=1
b=0
while g0+b*2 < g1:
    at=g0+b*2; root,ch=prog[b%4]; add(pad(ch, 2.0), at, .7)
    if b%2==0:
        for k in range(8):
            m=ch[k%3]+24+(12 if k in (5,7) else 0); s=saw(note(m), .18, (0,)); s=lp(s,.12)*env(len(s),.003,.09)*.08
            add(s, at+k*.25, 1, .35 if k%2 else -.35)
    b+=1
# "free" breakdown and a lift into the sponsor + end
for bar in range(4): add(pad(prog[(bar+1)%4][1], 2.0, .03), free_s['start']+bar*2, 1)
add(riser(3.0), free_s['end']-3.0, .6)
sp=[x for x in tl if x['key']=='sponsor'][0]
for bar in range(int((sp['end']-sp['start'])/2)+1): add(pad(prog[bar%4][1], 2.0, .025), sp['start']+bar*2, .85)
add(pad([57,64,69,72], 6.5, .05), end_s['start'], 1.3)
wet=np.zeros_like(out)
# cheap reverb via convolution with decaying noise
ir_len=int(1.6*SR); ir=np.random.randn(ir_len,2)*np.exp(-np.arange(ir_len)/SR*3.2)[:,None]*.02
from numpy.fft import rfft, irfft
L=N+ir_len; nfft=1<<(L-1).bit_length()
for ch in range(2): wet[:,ch]=irfft(rfft(out[:,ch],nfft)*rfft(ir[:,ch],nfft),nfft)[:N]
mix=out+wet*.6
fade=np.ones(N); fl=int(1.2*SR); fade[-fl:]=np.linspace(1,0,fl); mix*=fade[:,None]
mix/=np.max(np.abs(mix))*1.12
mix=np.tanh(mix*1.3)/np.tanh(1.3)
pcm=(mix*32000).astype(np.int16)
w=wave.open(sys.argv[1],'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close()
print("ok")
