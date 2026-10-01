"""Render a static contact sheet for the three interactive Get started studies."""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math

ROOT = Path(__file__).parent
S = 2
W, H = 1800, 920
im = Image.new("RGB", (W * S, H * S), "#16121a")
d = ImageDraw.Draw(im)

def font(size, face="bold"):
    names = {
        "bold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "black": "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "body": "/System/Library/Fonts/Supplemental/Arial.ttf",
        "serif": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
        "mono": "/System/Library/Fonts/Menlo.ttc",
    }
    return ImageFont.truetype(names[face], size * S)

def rect(box, fill, outline=None, width=1, radius=0):
    box = tuple(int(v * S) for v in box)
    if radius:
        d.rounded_rectangle(box, radius=radius * S, fill=fill, outline=outline, width=width*S)
    else:
        d.rectangle(box, fill=fill, outline=outline, width=width*S)

def line(points, fill, width=1):
    d.line([(int(x*S), int(y*S)) for x,y in points], fill=fill, width=width*S)

def ellipse(box, fill=None, outline=None, width=1):
    d.ellipse(tuple(int(v*S) for v in box), fill=fill, outline=outline, width=width*S)

def txt(x, y, value, size, fill, face="body", anchor=None):
    d.text((x*S,y*S), value, font=font(size,face), fill=fill, anchor=anchor)

def choice(x,y,w,h,title,sub,mode):
    if mode == "dark":
        bg, border, text, muted, accent = "#30203e", "#8e6db2", "#fff7ed", "#d1bddc", "#e3b973"
    elif mode == "folio":
        bg, border, text, muted, accent = "#f7ead0", "#332536", "#2a2028", "#675b63", "#6942bb"
    else:
        bg, border, text, muted, accent = "#f5ecd7", "#514459", "#27202b", "#655c66", "#6942bb"
    rect((x,y,x+w,y+h),bg,border,1)
    txt(x+17,y+17,title,16,text,"bold")
    txt(x+17,y+47,sub,12,muted)
    txt(x+w-22,y+21,"›",27,accent,"body")

# Header and guide
txt(48,37,"DELTAMON  /  DESIGN ROOM  /  01 OCT 2026",12,"#c3a6ff","mono")
txt(48,68,"THREE WAYS TO BEGIN.",51,"#f7efdf","black")
txt(49,133,"Original vector and type studies for the Get started popup",16,"#bfb4c4")
line([(48,173),(1752,173)],"#54485a")

panels = [(48, "01  THE COUNTERWEIGHT", "#382747"), (622, "02  THE APERTURE", "#281a37"), (1196, "03  THE ENTRY FOLIO", "#584039")]
for x,label,bg in panels:
    txt(x,197,label,15,"#e6d9ed","mono")
    rect((x,238,x+555,841),bg)

# 01 / sculptural printed case
x,y=72,275
rect((x+9,y+9,x+532,y+519),"#6942bb")
rect((x,y,x+523,y+510),"#f5ecd7","#27202b",2)
rect((x,y,x+225,y+510),"#e4d6bb")
line([(x+225,y),(x+225,y+510)],"#27202b",2)
txt(x+18,y+24,"DELTAMON / ACCESS",10,"#6942bb","mono")
ellipse((x+5,y+143,x+220,y+358),None,"#baa5a3",1)
ellipse((x+26,y+165,x+199,y+338),None,"#baa5a3",1)
line([(x+31,y+244),(x+196,y+208)],"#27202b",13)
line([(x+111,y+228),(x+111,y+389)],"#27202b",3)
ellipse((x+67,y+387,x+156,y+395),"#27202b")
line([(x+43,y+242),(x+43,y+301)],"#27202b",2)
line([(x+189,y+212),(x+189,y+297)],"#27202b",2)
ellipse((x+18,y+296,x+69,y+347),"#6942bb")
rect((x+167,y+295,x+211,y+339),"#c58b50",radius=12)
line([(x+18,y+457),(x+205,y+457)],"#a69487")
txt(x+18,y+470,"ILLUSTRATIVE OBJECT",9,"#695c62","mono")
txt(x+246,y+23,"STRATEGY 01 / ACCESS",10,"#6942bb","mono")
rect((x+466,y+17,x+501,y+52),"#f5ecd7","#938478")
txt(x+477,y+23,"×",22,"#27202b")
txt(x+246,y+98,"A way in,",38,"#27202b","black")
txt(x+246,y+143,"made yours.",38,"#27202b","black")
txt(x+246,y+208,"Choose the address you want to use.",13,"#655c66")
txt(x+246,y+228,"Your position stays with that address.",13,"#655c66")
choice(x+246,y+284,251,85,"Continue with passkey","Device or password manager","light")
choice(x+246,y+379,251,85,"Connect existing wallet","Keep your current address","light")

# 02 / luminous aperture
x,y=646,275
rect((x,y,x+523,y+510),"#21172d","#8067a5",1)
rect((x+8,y+8,x+515,y+502),None,"#57436e",1)
txt(x+22,y+22,"DELTAMON / ACCESS THRESHOLD",10,"#cdb4ee","mono")
rect((x+466,y+16,x+501,y+51),"#21172d","#685577")
txt(x+477,y+22,"×",22,"#f8f0df")
cx,cy=x+261,y+184
glow=Image.new("RGBA",im.size,(0,0,0,0)); gd=ImageDraw.Draw(glow)
for r,alpha in [(140,18),(110,25),(78,35)]:
    gd.ellipse(((cx-r)*S,(cy-r)*S,(cx+r)*S,(cy+r)*S),fill=(173,111,228,alpha))
glow=glow.filter(ImageFilter.GaussianBlur(22*S))
im.paste(glow,(0,0),glow); d=ImageDraw.Draw(im)
for r,color,width in [(136,"#564073",1),(113,"#72528d",2),(88,"#b693d7",3),(62,"#6c4b89",2),(38,"#d2afe2",2)]:
    ellipse((cx-r,cy-r,cx+r,cy+r),None,color,width)
for j in range(24):
    a=j*math.tau/24
    line([(cx+125*math.cos(a),cy+125*math.sin(a)),(cx+139*math.cos(a),cy+139*math.sin(a))],"#a981c0")
ellipse((cx-20,cy-20,cx+20,cy+20),"#f1d8b7")
ellipse((cx-8,cy-8,cx+8,cy+8),"#fff0d2")
txt(x+261,y+313,"Step into your position.",35,"#fff7ed","black",anchor="mm")
txt(x+261,y+347,"Pick the address you’ll use.",13,"#d1bddc",anchor="mm")
txt(x+261,y+366,"A new passkey creates a new address.",13,"#d1bddc",anchor="mm")
choice(x+24,y+402,231,84,"Continue with passkey","Your device, your key","dark")
choice(x+268,y+402,231,84,"Connect existing wallet","Keep your current address","dark")

# 03 / expressive paper folio
x,y=1220,275
rect((x+10,y+10,x+533,y+520),"#c88c53")
rect((x,y,x+523,y+510),"#f7ead0","#30212f",2)
txt(x+23,y+20,"DELTAMON / ADMISSION FOLIO / 01",10,"#6942bb","mono")
rect((x+466,y+16,x+501,y+51),"#f7ead0","#92806d")
txt(x+477,y+22,"×",22,"#2a2028")
ellipse((x+362,y+56,x+501,y+195),None,"#d8b681",24)
line([(x+429,y+95),(x+453,y+122),(x+429,y+149),(x+405,y+122),(x+429,y+95)],"#6942bb",5)
txt(x+22,y+91,"GET",79,"#2a2028","black")
txt(x+47,y+177,"STARTED.",70,"#6942bb","black")
for n in range(11):
    c="#2a2028" if n%2==0 else "#6942bb"
    rect((x+n*48,y+283,x+n*48+44,y+298),c)
line([(x,y+281),(x+523,y+281)],"#2a2028",2)
line([(x,y+299),(x+523,y+299)],"#2a2028",2)
txt(x+22,y+322,"Choose your way in.",22,"#2a2028","serif")
txt(x+23,y+354,"Use an address you hold, or open one with a passkey.",12,"#62565f")
choice(x+22,y+398,232,83,"Continue with passkey","Device or password manager","folio")
choice(x+267,y+398,232,83,"Connect existing wallet","Keep your current address","folio")

txt(48,863,"01 / BRAND SIGNATURE",11,"#b9a9bd","mono")
txt(622,863,"02 / MOST IMMERSIVE",11,"#b9a9bd","mono")
txt(1196,863,"03 / EDITORIAL CLARITY",11,"#b9a9bd","mono")

im.resize((W,H),Image.Resampling.LANCZOS).save(ROOT / "get-started-comparison.png")
