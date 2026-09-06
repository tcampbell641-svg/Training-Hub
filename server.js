import express from 'express';
import pg from 'pg';
import QRCode from 'qrcode';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
const APP_NAME = process.env.APP_NAME || 'Mahindra Technician Training Hub';
const INSTRUCTOR_PIN = process.env.INSTRUCTOR_PIN || '2468';
const MAHINDRA_LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAbEAAABkCAYAAAAIVA6ZAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAIdUAACHVAQSctJ0AABjlSURBVHhe7Z0LlCRVeceb5aHyWJad6QcGBXVdcYVlZ/qxokcngoQ9oCK6mwRBNvvq6a57b1X1go9wjCsaNeEcjxLf7wfRIJ4YI4liDOIrEg0mmpC44Mow/ZgFYQV5L7CQ7/bcmamu+bqq+rndO//fOf9zdufe77u3qrrvv2/1rdux2onrn4YWND2a/vpdibEzp0fGnh0DTaklsl/jzl+Qqqnsk7XRjGtSDAXccYQqlbnxF7G1x5gUYEBgr1WIKoncPeXR7CtNCjCIcBcOWv90OZn7r2oi82pzmoAPmFiAYGIDCXutQgQTGwK4Cwd5FE9f+XQsdpg5XcAAEwsQTGwgYa9ViGBiQwB34SCf4lllThcwwMQCBBMbSNhrFSKY2BDAXTioUZVU5ve10fFxc8oAARMLEExsIGGvVYhgYkMAd+GgxSrHs980pwwQMLEAwcQGEvZahQgmNgRwFw7iZU4ZIGBiAYKJDSTstQoRTGwI4C4cxKsaH3uvOW1LHphYgGBiAwl7rUIEExsCuAsH8ZpOrPu5OW1LHphYgGBiAwl7rUIEExsCuAsH8aqm0rea07bkgYk1VzWR/efrYrHDTQowIHDXKkwwsSGAu3AQr0oi87/mtC15YGKMkrndtUT6IyYUDBjsNQsRTGwI4C4cxAsmtgBMrFHVVObmyui6F5owMIBw1y1MMLEhgLtwYaqmcp824W1RO/a0U+nF8VsudxRVk7kbTKqWqKw4bS0NpDUuZxTBxBaAic2qkso+UEnmzjLVwQDDXb8wwcSGAO7ChalTE9NURnJncbnDVEllnjQp2qJ2bHqUBp0fc7nD1A0Tmz7+9OdXE+N/Qefw/QdT5UTmndOj468w3WqZXphY/dykcu/097Vd1ZLZd83ExzaY9G3BHce8krkP1OLZc03VluH6PEiqjI6fX4udeLTpbteorFh3RiWZfTvXZi/FXsMQtWNiT8fSR9L740KuD/1SJZGeNN1ZxN7k2mOqycwWLq6fmklk31dOZrb+auRFx5mutQd34cJEHejYxO5KrF/L5Q5TNZn+tknRNtT/q7ncYerExG6KxY6gT+0fJj1I7R/g8vdTlVTuKRrkH6G+3F9LpC8w3YxMt01sJpWx9Lmp94uJbUc6F83aH6sfIxlaO3tg8nmzT9w5kn4b5VtmqjUwnchdfUuEwZ/LPVCic6d3qyHdYbrcEfeMpP9QXwsyhofp2vT1PVBJjv2I+3uYWjWxWmz1aI2OkV53+7l8fVMiu910qYG9seQxldT639dS6x9n4/qo+nud+qH7U03k/mPq6DUp083W4JKHiV6IB83EaqnM9SZF29wxum6C3qAtv8jaNTE9eNIn9mu5nIOiajxdmVk59mLT5VC6aWJTibEztYFxMd1UNZ7ZXxvNtTT7bIhP5PbTDOJfnqKBwBTPMxU7+ZmVeO5SGrzui7rE3pt70EXv+T2VkbFLTNdbQr+uqon0L7i8fVEid682IrYsRFFNTL/Hy/HMW7gc/VYlnvmM6VYD9Zk1U39QVE5lD9AH6ouoq6192OSShWnYTWxqNDPWTxOrJLIf5vINmvQn7r0Rn2/qlontPWZtojKauYOr3wtVkrl79ibH15vmQ/HGzoxmJm5fuWq5KZqndkL65XRs/z4/izwETUyrmsjuvzOelqb7kbg1tubYajK7h8vXL9GHj++TyRzOlYUpqolV4uvOoLptf8/fTVWPy46Ybs1z58rcGnrt7+XqD5Lqd0/imctNt6PBJQoTTCw6e0fGX1VLZPZx+QZR1ZHxR6PcduuWiVXi6XdxdXspfTuLmo70aY9e64/r577ujS02r5kVYydXUxlrURuHqIlp0bn72e5jV4+aQwilFs/cyOXpl2hQfMh0pa3zHdnEkum3c/H9FH1Y2Hd3fGyV6VIDVHYNFzOoqqwcf6npejhcgjDBxKJD7XyXyzXIKo+u22a635RumFg1mRFcvb5oZOxK041A9C1C8895tMnPxDNvpBn2NJv7EDYxrZlEJm8OIZDaCdlzufh+yrvAgSsPU1QTK6eyD3Dx/ZL+jnE6nnmP6U4DdAxXcDGDrJZWoHMJwgQTi0YlmfkGl2fgFc9eaw6hKZ2aWPX4tWPUTpmr1w+VE9ly/UDaoDqSeXT+1iGnQ9zE6P1/wBxCIOVE+qtcfN+Uyl5bjp30LNOdnpoYF9tP6QVMpisNVE8YO7MSz9zNxQy6zCGEwwWHCSYWTjWRPbOWyD3G5Rl0Ud+/VYulA1fXdWpitWT2E1ydfon6MnPf8WesqB9MRGqJzBXU7yqXr0GHuIlpmUMIhMaJ67jYviiRfWwqnnmD6Uodtl6IhsLEkpkq9xUA/W1ZJZX9ChszBKquGHutOZRguOAwwcSC+c0Ja55bjje51TQEqsbTt+pntszhsHRiYtOJzMFf6JLK3T8zum7CHE4gt8ZiR80ks9FvC8PEYrfHYs+oxXPXc7H90HQy/UvTlXm4emEadBMrp3JPVRLjjulGA9Vk+oNczLComhj/kjmUYLjgMMHEgqFP7A4XPyyqJLK/Kjf5gniOdk2sGh+7ml4/93Pl/RR9Qn2glkifYw6nKfrB1Woy82kuR1PBxGL6Nl41kfsWF9tL6UccyHh+YLrRAFc/TINsYuVk7jYakz5mutDAb0fXvZCLGSZVInytUYcLDhNMLJiZVO7NB1OVVO5S/ZAqdwxR1EsTI4P/ItfnVqWf9OfaiKqoJlZevmaV/rTL5WiqHpoY9eUnZKpbuXMSVZVk1taPU3D5o8ocQlO6YWL0fruC63+Qqons2dytNQ3XRpj6YWL6GcmZxPr3cccTpDtWjJ1sml9ENZ55GRfTT9H1+yF3vFEFEwugXws7Dia3xGJHziQz3+GOI0w9NTHfEvtOuD22ank1nr0pcJFFE0U1sWoqPcXFB6qHJkbvvS/rB6tNio7Qy8+5NqLIpGhKJyZWTWQeuXN0/HyTqmtwbYWp1yamd/bQt15NmkOOysrx9e3uDgITC2ApmJhGD3bccYRpWExMM70y82qanbQ8GEc1MS42VENiYnphSzWZvY9rJ0wmRVM6monFs283aboK21aIem1iM77FJ4ci2i+4Yw8TTCyApWJiGurzz7ljCdIwmZiGDKnlJcQwsdnn3aqpTFsb45oUTenExG6JpY80aboK11aYemli+jb1VAtbvQ0rNAZdwh1/mGBiASwlE6NP2i2vUIKJLcDFhmpITExTO7G9B2FNeFM6MTGToutwbYUJJtY5lcRYW2M9TCyAfppYefnYqmp8fHM1kS70TCe85DmmuUXAxHjBxGaBiQXrUDAx/cxnZTR9Hjt2dEnl0bGm5wgm5tcQmBi9Cw8n49I/LfIEl6cnajIgw8R4wcRmgYkFa5hN7K7Eacn6xgVM270QjY+3cLeCYWJ+DYGJVVLpq7j4XorM6pOm+QZgYrxgYrPAxII1rCamf3KIXuM9/3kjr+h4HqomMq8zXZgHJubXgJsYvQOX6c04ufheqprMsT8WChPjBRObBSYWrGE1sZlkeysCO1Yyt2jzcJiYXwNuYvTG/QEX22vBxPg2mwkmNgtMLFjDaGLlZDpHr5OD88vNMLEIgomxgonxbTYTTGwWmFiwhtHE6puPM+31RTCxCIKJsWpmYuVU9ptc/SDBxBbgYkMFE4OJRRBMLFgwsQBgYsGCiS3AxYYKJgYTiyCYWLBgYgEMmontOe7FL7w3llveiWqxE9nf/4KJ8YKJzQITC9aSMbFE+vP3xc5YwY0trYgu3hGmG/PAxPw6xEysksqVTGhPgInxgonNAhML1lIwMXpNPU5h7M7/3QAm5hdMrCVgYrxgYrPAxIK1hEysZ8DE/IKJtQRMjBdMbBaYWLBgYp0DE/MLJtYSMDFeMLFZBtHEqsnMn5g0XYVrK0wwsc6Bifl1iJkYDew7aURY1ivBxHjBxGYZRBOj19bvqiNj+hea2dd0u2LbCtFSMTHufHVLlfi6M7h2wwQTC2CgTCyR2UcD6lTPFM89zLUbJJjYAlxsqGBinZnYAGmJmNiBhjGjy6olM1Wu3TDBxAIYJBMbRMHEFuBiQwUTg4lF0KCY2KAKJhYATCxYMLEFuNhQwcRgYhEEEwsWTCwAmFiwYGILcLGhgonFrovFDq8kc1/nYodJMLGDJ5hYADCxYMHEFuBiQwUTq1NOpb/KxQ6TYGIHTzCxAGBiwYKJLcDFhgomVmcqse4iLnaYNIwmNkUmVqHcXJvDJJhYAL00sXJy/B+52GESTGwBLjZUMLF5Ksn0UN9SHMqZ2Oja1ZVUZoprc5gEEwuglyamoT7ezMUPi2BiC3CxoYKJzaMXeMyQkVXbeL8NgobRxDQziexOrs1hEkwsgF6bWPW4U0eqicx1wzqlh4ktwMWGCibWwL0rVy3X55rec7dxuQZZw2pidIGWTSdyF5TjmUe5todBkU0MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgkOWwYtHOFovyfMty/7hY3Pky83cAAAAgFtu6detxStlXSeV8rlMJ4X7Wks6OfD5/tEnfEVI6X7CEfUDZpafnJIT6lCkGAACwlFFKPUMI5xavSXRRj9MM6tIN1IZpriUo9tVMTjIx9zFTBQAAwFLmsssuO4Yzim6qaLm/J6M8NxbbdLhpNhJSlr7A5YOJAQAAqHMJmVhROk9wZtFNCVsbmf1G02wkLp2c/AMu15Ytk2tMFQAAAKAR/X2W3zg2bNgQ6Zag4zinWML+ppTO/f4cWnqRhqkaiaKUl0jp/uucLEtdYIoAAACAxZCJneo3H1MUmWJRvUoq53p/Hqns/7ZtO2mqAQAAAN1l0nI+5zcfU9QSO3aoFxSlfZs/l1Lum00VAAAAoLsUhXOX13Qs4ew3RS1jSfln3lz1fNKWphgAAADoLn7T0bMpU9Qyu3btWubPJ4T9NVN80Ni2bdvKHTt2nF6Q8hVSylPp//oW52Gzpd1h8+bNz6Tcz8tb1tlS7jx1cnLyFPpzSys0AQAAtIjfdGjm9BFT1Bb+fEI4N5uiBvL5/JFKuReQyV1oKfcfpHTutKzSjJD23VK6P6O/v8ayrJSpHhltpJOWukAo+xNSuU/5++OVkM4BqnMD9fF127aVVpoUoUxMTByh+056D/V3P5d7TkK6T1qW81E6Rr1IpavGCQAAS51FMycabDv6DsufT4jSd0xRA5ayb/TX9YoM5gkysjeZ6pGwVGlD3ZSkE2hefmmzs6RzHRnrqEnVlKJ0z9crJ7k8QdJtCKEupxTLZjMBAADoCL1HoX+wFXapJePw489H5vAhUzTPjh07TvTX4yRsd7MJCUUIsZrLUTcP6eyXynnUEu5jNOtq+pyclKUzTLpFFIvFE8hUr1oUU89vP0Qzrikp7d/MiWZpNSp70l8fjw0AAECXoEH5b/2DbLdNTErnUlPUgCXdv6TBfpcl7StoZvNWMru3+GOjmhi1sckfawn7CZ2X2ihZSm21LOciMpA3F4tuXij3cqO/98Y0MzFtumR+3/PW1bKE859CuJdrY9Jbepnqdej/J1F+8lZ3tz/OVAEAANAJ3Taxiy++eLk/X8AS+4bvh6TceZE3jmYxvysW1R+Z4qZYlnUyzYRu9cbSrOiXUb5P27Vr1xE0w1qrYyzLvWbNmk1HmaIGipb9Yz3j8rYxOel8329cHPl8PkPn+SFvLP3/QlMMAACgXfwmJpV9NxlH2z9/Im3nS758v94udq42xYH4906kWdQvt2zZEjfFTaFZ0AZvnJDOPvpz11YFCqW2e/Pr25J03j5miiNBM8VPenMUi871pggAAEA7mBV213kHVzKdn+vl6KZKS0wqtcYSbsWbjwbrr5viUBaZmHJ/Qn8OXQQhpbrJGydEqWuzHL2RMc3y5rfUqs/GlP0VvZzeVImE38SkUjeZIgAAAO2gv+exlP3ThsFVuj8wxS2hlIr7t50SsnS7KY6E38SE7f6bKQrEG1OPE6XTTVHHSNvd1ZjbnjFFLeE3McrzT6YIAABAO0xKmaOZxYPewbUdEytI9yz9LJg3D/3/+5s3R3/GS284TAP717w5CkL+yBQH4o3R6paJ6efNLGE/4s0t6ZyZ4pbwmxiZPlYoAgBAJ1iO88qGgZXUiolt2rTpKMsS+xrilfsU6eGJiYmWbrflbfu5erNgby4ywm+b4kAKyrnDG1dUble+byoUxGu8eQvKvtMUtQQZ1ph+5m0ujz5HpggAAEC7cCY2J5oV3aNnUzSD+JxQ7lVkblfS/99dlPan689AMTFSOXup7G9M+pawLGe9st3HvfkKBXmWKQ5ECCW8cVqWUhvJZDta3KEXcHhzSlnaZooiU5TOG4Rw93jzFIT7KVMMAACgXYJMrFXpTX5pxvECk7pllNr5Mn9OUxTKDjJAMlrfQ8Xuw/oZLipue5unxnyzx2iKQtHGqldX6lmpNwf97YZ8Pn+8qQYAAKBdisJ2vAOsFv3pZiHd3TRgNzzX1EyWZZdMuo7oxMQ0lnTe4Y+fk6Xcb9FM75WWZa0y1UOhul0z+DlZyv5xK30AAAAQgJROw3dQWnpT3knHOWXSss9Tyr3YK2GXtvjrC+W4Jl1HkBee589tiiKhbx3S8Uz6c3gllfNrMrRr8nl5qglrilDqU1yOdiSlXbWUU6S02DMRAAC6hV5g4B9wTRFLfQWhdKe99fXtMr3Aw1RpG5qlfNebt1BwKqaoJSxLXkR9upe0aM9Cr4RwvlcsFp9jwhZBZvcZb32dT0jnAUYPzUnZ7oOevz9Axn8tnZtjTUoAAADdxDtIz8kUNUUIewsN0PM/PUL/PqD3QDTFbSMWL/X/K1PUFkXhOtS3L5ECd7MvSvut27erk0zYPH4TU8r5qSmaRz/wvEWpuBDi2Vr5/NvwXRcAAPSLhkGaJJV9vylqSj6fP5rq3eaN0w8Amx+AbBtvPq2C2jlmitpm06ZdR01OOqcUi84bpHTu8behpWdYluVcY0LmiWJiAAAADhLcRr3cYM5hWdZfL4rt7DfIDluUz3JfYsq6Bs2WzqEZ3o/8bWlJKV9uqtWBiQEAwACTt+yzGwZp0qSwzzHFoVjKvtsbK6T9iClqmS1bVNybS6sXJqbZunXrcTRzvHBRe8K9z1SpAxMDAIABpiCdbzcM0iTHcV5kikOZpJmL9C8MUaUfmuKWEMJ5vzePvsU3OanWmOKeIGWJfHihTSGdJ0xRHb+J6Vuo+bz9XFMMAADgYKKfBfMO0lqtmNh2pU7SO95744Vwp3YI0fK+hdSX/2nM49wc5SdYOoFmY2/y7sixyMSkfWVDn6RzgI4v8q9MAwAA6CGdmpjGsuTHvfF6ZmZZ7sWmODJ+E9Ob5erNd01xTyATO4f6+7u5Nv0mtnHjxmd5+6RFxnaZKQYAAHAw8ZsYDeL7pJTPM8WRISNo2O/QstR++nNLBuQ3MaXcq01RU/TDzWREf0qGt8n8qSX8txMt4e4xRfPQOWnYO7Fez3LWmeKuoreiouPeOCf9i9YbN5aeZYoBAAB4WTQTU27LP/So0Sv+GvKQilLdYIoj0Y6JkXnWfwhTz/6k7bS66fAyqexbvW0Wi86LTdk8eqsqbx0t6uv05ORkW9/XFaVzPX1QeL357zyFgnyFUvYPG9pS7oNCuMpUAQAAMIeecfl/gdmSzodMcUsopZ4hldOwUlF/16QfINamqB8CLhQKCVN9EXoGQvUbnjujAfyL+tel9RZYFD8ixM7VOg9Vr2/mq3cIaahvlCfT0XV1zrm6XnRf9SbFwnYem4vRJli0nF+YKn4OK9qN58nEPGhZ9nnUjl7owW0wvKxUKq2c7ffO1WSy35iPV+4nTJ15hHL+3JvfK1MFAADAHEWlXiuk/YB3sJS2+wFT3DIFy7Et4Rzw5tOzKymdv9O36cg09G7yLHWjk+7/eWO19PNcQrmf14s86vmEu3tuZ42JiYkj/PUbpOwb9eyMcnywQcr5MhlQw67y1PbUpGq+EnKHEONkPDVvzHysUDNU9mF/O2RKH9W/Ss3FcCZWFO5dbF2SqQIAAGAOmtVsJxOb3zpKqxMT04swaPBeZERemaosi24nMhLC3u9ddk8zoUXPubUjPdszKZtSLLrP52JblZ71FQqLF89IaZe5+kVZustUAQAAMEehUHipsEu/nRss9fLxolDvMsVtQTOm93oH4Hmp0uNC2V8x1Vho5vJu6kPTPQ5p8H/SstSiHUEK0j2LZmif1bMpLq6Z9OxOt7nZcVaYVKHonf31zDKon80kZOk+mlU2PQdFKV9PeRtmxnRMuy3LOtlUAQAA4MW27dP09zo0C7iEjCCzzbaTpqhdDpNSXmoJuY9mefcXi/YeYdubKfe4+Y4qkHxeZAqW8xbLcu8gTRcK9m1Sli7TfSvadpqqNP1xy/r3XFRPi/69UZsmmd5umr39RueyLGcPGdDH5+oEfUcXhJ616X6SCZ5rKfVTr+n4Refgbmr3HfX26FxP7Np1hEmzCP1dnRCl0+f6p2VZl5GBxWL/D2MZewAtuL4aAAAAAElFTkSuQmCC';
const NAZAR_SIGNATURE_DATA_URI = 'data:image/png;base64,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';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for cloud mode.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function code6(){ return Math.floor(100000 + Math.random()*900000).toString(); }
function certNo(){ return 'MTH-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
async function ensureCertificate(studentId){
  const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[studentId]);
  if(existing.rows[0]?.certificate_no) return existing.rows[0].certificate_no;
  const cert=certNo();
  await pool.query(`INSERT INTO instructor_notes(student_id,certificate_no) VALUES($1,$2) ON CONFLICT(student_id) DO UPDATE SET certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[studentId,cert]);
  const check=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[studentId]);
  return check.rows[0]?.certificate_no||cert;
}
function layout(title, body, extra='') { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--red:#c4141c;--red2:#9f0f15;--black:#171717;--line:#dedede;--soft:#f5f5f5;--muted:#666;--green:#1f7a3b;--amber:#a55b00}*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1d;background:#f6f6f6}.top{background:var(--black);color:#fff;padding:18px 24px;border-bottom:5px solid var(--red);display:flex;align-items:center;justify-content:space-between}.top b{font-size:21px}.top span{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#ddd}.wrap{max-width:1180px;margin:auto;padding:24px}.card{border:1px solid var(--line);border-radius:16px;padding:20px;margin:14px 0;background:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:18px}.home-card{display:block;text-decoration:none;color:#1d1d1d;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;min-height:150px;transition:.15s ease}.home-card:hover{border-color:#bbb;transform:translateY(-1px)}.home-card .icon{font-size:30px;margin-bottom:14px}.home-card .title{font-size:22px;font-weight:800}.home-card .desc{color:var(--muted);margin-top:8px;line-height:1.45}.hero{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.hero h1{margin:0;font-size:30px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:800}.btn,button{display:inline-block;background:var(--red);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;cursor:pointer}.btn:hover,button:hover{background:var(--red2)}.btn.alt{background:#333}.btn.light{background:#eee;color:#222}.btn.light:hover{background:#ddd}.btn.danger,button.danger{background:#a00000}.btn.danger:hover,button.danger:hover{background:#7d0000}.big{font-size:24px;font-weight:800}.muted{color:var(--muted)}.code{font-size:50px;font-weight:900;letter-spacing:6px}.stat{background:var(--soft);padding:16px;border-radius:14px}.stat b{display:block;font-size:28px;margin-top:4px}.stat span{font-size:13px;color:var(--muted);font-weight:700}.stat.green b{color:var(--green)}input,select,textarea{width:100%;padding:12px;border:1px solid #bbb;border-radius:9px;font-size:16px;margin-top:5px;background:#fff}label{font-weight:650;display:block;margin:12px 0}.q{padding:14px;border:1px solid #ddd;border-radius:10px;margin:12px 0}.q label{font-weight:400;margin:8px 0}.q input[type=radio]{width:auto;margin-right:8px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;background:#fafafa}.pass{color:#0b6d2f;font-weight:800}.review{color:#a14500;font-weight:800}.danger{color:#a00000}.qr{max-width:300px;width:100%;height:auto}.center{text-align:center}.steps{font-size:18px;line-height:1.6}.pill{display:inline-block;background:#eee;padding:6px 10px;border-radius:99px;font-size:13px;font-weight:800}.pill.open{background:#e8f5ea;color:#1f6f38}.pill.closed{background:#f1f1f1;color:#555}.pill.joined{background:#eef3ff;color:#274d9c}.pill.results{background:#e8f5ea;color:#1f6f38}.pill.testing{background:#fff3cd;color:#805600}.pill.hunt{background:#f3e8ff;color:#6b2b91}.progressbar{height:10px;background:#ececec;border-radius:99px;overflow:hidden}.progressbar>span{display:block;height:100%;background:var(--red)}.rating{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.rating label{border:1px solid #ddd;border-radius:8px;padding:9px;text-align:center;font-weight:600}.rating input{width:auto;margin:0 4px 0 0}.feedback-good{border-left:5px solid var(--green)}.feedback-miss{border-left:5px solid var(--red)}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.alert{padding:12px;border-radius:9px;background:#fff3cd;border:1px solid #ffe69c;color:#000}.alert *{color:#000}.success{padding:12px;border-radius:9px;background:#e8f5ea;border:1px solid #b9dfc0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0}.join-box{background:#fff;border:2px solid #eee;border-radius:18px;padding:22px}.live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2f9e44;margin-right:7px}.small{font-size:13px}.nowrap{white-space:nowrap}@media(max-width:700px){.wrap{padding:14px}.top{padding:14px 16px}.top span{display:none}.code{font-size:38px}.hero h1{font-size:26px}.home-card{min-height:125px;padding:18px}th,td{padding:9px}.desktop-only{display:none}}@media print{.no-print,.top{display:none!important}.wrap{max-width:none;padding:0}.card{border:0}.report{font-size:12pt}body{background:#fff}}
</style>${extra}</head><body><div class="top"><b>${esc(APP_NAME)}</b><span>Cloud Training System</span></div><div class="wrap">${body}</div></body></html>`; }

const DEFAULT_QUIZ = [
['Before replacing a component during diagnosis, what should the technician do first?',['Clear all codes','Prove the failure','Disconnect the battery','Replace the ECU'],1],
['Approximate resistance of a properly terminated CAN network with power off?',['120 ohms','60 ohms','12 ohms','0 ohms'],1],
['Which tool is used on supported Mahindra systems to communicate with controllers?',['Timing light','GARUDA','Vacuum gauge','Compression tester'],1],
['Diagnosis should begin by understanding and verifying what?',['Customer complaint','Parts price','Warranty claim','Service interval'],0],
['Freeze-frame data shows what?',['Operating conditions when a fault occurred','Technician name','Parts inventory','Warranty expiration'],0],
['CAN High and CAN Low are primarily used for what?',['Controller communication','Starter current','Hydraulic pressure','Fuel return'],0],
['Best diagnostic practice?',['Replace the most common failed part','Verify inputs and outputs and prove the failure','Clear codes and release','Replace related sensors'],1],
['Low battery voltage can cause what?',['Communication and starting problems','Only tire wear','Only hydraulic leaks','Only PTO noise'],0],
['When measuring resistance, the circuit should normally be what?',['De-energized','Powered','At full throttle','Under hydraulic load'],0],
['Live data helps a technician do what?',['See controller inputs and outputs while operating','Program the radio','Check tire pressure','Print an invoice'],0]
];
const DEFAULT_HUNT = [
['Diagnostic Connector','Locate the tractor diagnostic connector and identify the diagnostic tool used here.','GARUDA'],
['Engine ECU','Locate the engine ECU and identify its role.','ECU'],
['CAN Network Check','With power off, enter the expected normal resistance across CAN High and CAN Low.','60'],
['Battery Voltage','Enter a normal fully charged 12 V battery key-off voltage.','12.6'],
['Proof of Failure','Describe the measurement or data that proves the planted fault.','measurement']
];


const HUNT_MODEL_SUGGESTIONS = ['Fifty One Hundred Refresh','Fifty One Hundred','Six Thousand Series','Forty Six Hundred','Forty One Hundred','Thirty One Hundred','OJA 1100','OJA 2100','SU Series','ROXOR','1600 Series','2600 Series','4500 Series','Custom Tractor'];
function is5100RefreshModel(model=''){ const m=String(model).trim().toLowerCase(); return m.includes('fifty one hundred refresh') || m.includes('5100 refresh'); }
const HUNT_ITEM_LIBRARY = [
{id:'battery',label:'Battery Location',task:'Locate the battery and identify its location. Enter BATTERY when complete.',expected:'battery'},
{id:'air_cleaner',label:'Air Cleaner Location',task:'Locate the air cleaner assembly and identify how it is accessed for service. Enter AIR when complete.',expected:'air'},
{id:'diagnostic_connector',label:'Diagnostic Connector',task:'Locate the tractor diagnostic connector and identify it. Enter DIAGNOSTIC when complete.',expected:'diagnostic'},
{id:'ecu',label:'Engine ECU / Controller',task:'Locate the engine ECU/controller and read the controller identification from the label. Enter ECU when complete.',expected:'ecu'},
{id:'fuse_box',label:'Fuse / Relay Center',task:'Locate the main fuse and relay center. Enter FUSE when you identify it.',expected:'fuse'},
{id:'main_ground',label:'Main Ground Point',task:'Locate a primary engine/chassis ground point identified in the service information. Enter GROUND when complete.',expected:'ground'},
{id:'crank_sensor',label:'Crankshaft Position Sensor',task:'Locate the crankshaft-position sensor. Enter CRANK when you identify it.',expected:'crank'},
{id:'cam_sensor',label:'Cam / Phase Sensor',task:'Locate the cam/phase sensor. Enter CAM when you identify it.',expected:'cam'},
{id:'rail_sensor',label:'Fuel Rail Pressure Sensor',task:'Locate the fuel-rail pressure sensor and connector. Enter RAIL when complete.',expected:'rail'},
{id:'fuel_filter',label:'Fuel Filter',task:'Locate the fuel-filter assembly and identify its service access. Enter FILTER when complete.',expected:'filter'},
{id:'hydraulic_pump',label:'Hydraulic Pump',task:'Locate the main hydraulic pump. Enter PUMP when you identify it.',expected:'pump'},
{id:'hydraulic_test',label:'Hydraulic Pressure Test Point',task:'Using service information, locate the specified hydraulic pressure test point. Enter TEST when complete.',expected:'test'},
{id:'pto_control',label:'PTO Control / Solenoid',task:'Locate the PTO control solenoid, valve, or actuator used on this tractor. Enter PTO when complete.',expected:'pto'},
{id:'three_point',label:'Three-Point Control Components',task:'Locate the primary three-point hitch control or valve components. Enter THREE when complete.',expected:'three'},
{id:'cluster',label:'Instrument Cluster',task:'Identify the instrument cluster and have the Verifier point out the major warning/indicator area. Enter CLUSTER when complete.',expected:'cluster'},
{id:'seat_presence',label:'Operator-Presence Seat Detector',task:'Locate the operator-presence detector/switch incorporated into the seat system. Enter SEAT when complete.',expected:'seat'},
{id:'refresh_battery_air',label:'5100 Refresh — Battery & Air Cleaner Relocation',task:'Find the battery and air cleaner in their Refresh locations and discuss how those locations differ from the earlier tractor. Enter FRONT when complete.',expected:'front'},
{id:'refresh_app',label:'5100 Refresh — Accelerator Pedal Sensor Mounting',task:'Locate the accelerator-pedal-position sensor and identify the revised mounting location. Enter APP when complete.',expected:'app'},
{id:'refresh_cooling',label:'5100 Refresh — Water Pump / Crank Pulley',task:'Locate the modified water-pump area and changed crank pulley. Enter COOLING when both have been identified.',expected:'cooling'},
{id:'refresh_exhaust',label:'5100 Refresh — DOC / Exhaust Arrangement',task:'Locate the integrated DOC/exhaust arrangement and identify the changed service layout. Enter DOC when complete.',expected:'doc'},
{id:'refresh_oil_cooler',label:'5100 Refresh — Oil Cooler Location',task:'Locate the revised oil-cooler position. Enter COOLER when complete.',expected:'cooler'},
{id:'refresh_hyd_inlet',label:'5100 Refresh — Hydraulic Pump Inlet Pipe',task:'Locate the modified hydraulic-pump inlet-pipe area and identify the improved pump mounting-bolt access. Enter INLET when complete.',expected:'inlet'},
{id:'refresh_egr',label:'5100 Refresh — EGR Mounting',task:'Locate the EGR assembly and identify the revised mounting arrangement. Enter EGR when complete.',expected:'egr'},
{id:'refresh_oil_fill',label:'5100 Refresh — Engine Oil Fill Location',task:'Locate the revised engine-oil fill location. Enter OIL when complete.',expected:'oil'}
];
const HUNT_ROLES=[
{name:'Navigator',duty:'Read the station task and use the service information.'},
{name:'Locator',duty:'Physically locate the requested component, connector, test point, or system.'},
{name:'Tool Operator',duty:'Operate the DVOM, diagnostic laptop/interface, gauge, or other required tool.'},
{name:'Recorder',duty:'Enter the verified answer or measurement into the Training Hub.'},
{name:'Verifier',duty:'Confirm the item is correctly identified and explain what was learned before moving on.'}
];
const HUNT_MAX_TRACTORS=5, HUNT_TEAM_NAMES=['RED TEAM','BLACK TEAM','GRAY TEAM','BLUE TEAM','GOLD TEAM'];
function huntTeamInfo(rosterIndex,tractorCount=3){tractorCount=Math.min(5,Math.max(1,Number(tractorCount)||3));const teamIndex=rosterIndex%tractorCount;const memberSlot=Math.floor(rosterIndex/tractorCount)%HUNT_ROLES.length;const rotation=[];for(let i=0;i<tractorCount;i++)rotation.push(((teamIndex+i)%tractorCount)+1);return {name:HUNT_TEAM_NAMES[teamIndex]||`TEAM ${teamIndex+1}`,teamIndex,memberSlot,rotation};}
function huntRoleForStation(memberSlot,stationNumber){return HUNT_ROLES[(memberSlot+Math.max(0,stationNumber-1))%HUNT_ROLES.length];}

const DIAGNOSTIC_SIMULATIONS = {
  '5100-crank-no-start':{
    key:'5100-crank-no-start',series:'5100 Series',level:'Level 2',title:'Cranks, No Start',model:'Mahindra Fifty One Hundred Refresh',workOrder:'SIM-NOSTART-001',hours:412,complaint:'Engine cranks normally but will not start. No exhaust smoke is present while cranking.',assignment:'Diagnose the root cause, select the correct repair, and verify the repair.',
    rootCauses:[
      {key:'cam_sensor',diagnosis:'Failed camshaft position sensor',repair:'Replace the camshaft position sensor and verify synchronization and engine starting',replacementAction:'replace_cam_sensor',proof:['cam_circuit','cam_meter'],points:{cam_circuit:20,cam_meter:15},overrides:{live_data:'Engine RPM: 215 RPM | Rail pressure: 29.4 MPa | Cam synchronization: NO | Battery voltage: 10.9 V',cam_circuit:'Cam sensor connector and harness are intact. 5 V reference and ground are present.',cam_meter:'Cam sensor supply: 4.98 V | Ground voltage drop: 0.03 V | Signal: no switching signal while cranking.',rail_pressure:'Rail pressure reaches 29.4 MPa while cranking, which is sufficient for starting.'}},
      {key:'ecu',diagnosis:'Engine ECU internal failure',repair:'Replace/program the engine ECU after proving all powers, grounds, network and inputs are correct; verify starting',replacementAction:'replace_ecu',proof:['wiring','ecu_power_ground'],points:{wiring:20,ecu_power_ground:15},overrides:{live_data:'Engine RPM: 218 RPM | Rail pressure: 29.7 MPa | Cam synchronization: YES | Battery voltage: 11.1 V | Injector command: NO',wiring:'Wiring diagram review identifies the ECU power, ground, crank/cam inputs and injector output circuits required for the no-start.',ecu_power_ground:'All ECU powers are within 0.2 V of battery voltage and loaded ground voltage drop is 0.04 V. Inputs are valid, but injector command remains absent.'}},
      {key:'fuel_filter',diagnosis:'Restricted fuel filter / low-pressure fuel supply',repair:'Replace the restricted fuel filter, prime the fuel system and verify rail pressure and engine starting',replacementAction:'replace_fuel_filter',proof:['fuel_filter','rail_pressure'],points:{fuel_filter:20,rail_pressure:15},overrides:{live_data:'Engine RPM: 214 RPM | Rail pressure: 6.1 MPa | Cam synchronization: YES | Battery voltage: 11.0 V',fuel_filter:'Fuel filter inlet vacuum is excessive and supply volume is below specification.',rail_pressure:'Rail pressure remains at 6.1 MPa while cranking and rises when an alternate clean fuel supply is used.'}},
      {key:'hp_pump',diagnosis:'High-pressure fuel pump cannot build required rail pressure',repair:'Replace the failed high-pressure pump after confirming supply and control, then verify commanded/actual rail pressure and starting',replacementAction:'replace_hp_pump',proof:['rail_pressure','pump_control'],points:{rail_pressure:20,pump_control:15},overrides:{live_data:'Engine RPM: 216 RPM | Rail pressure: 5.4 MPa | Cam synchronization: YES | Battery voltage: 11.0 V | Fuel metering command: HIGH',rail_pressure:'Rail pressure remains at 5.4 MPa while cranking even though low-pressure supply is within specification.',fuel_filter:'Fuel supply volume and filter restriction are within specification.',pump_control:'Fuel metering command and circuit are within specification, but commanded rail pressure is not achieved.'}},
      {key:'injectors',diagnosis:'Injector electrical failure',repair:'Repair the failed injector circuit/component and verify injector command and engine starting',replacementAction:'replace_injectors',proof:['injector_resistance','injector_pulse'],points:{injector_resistance:20,injector_pulse:15},overrides:{live_data:'Engine RPM: 217 RPM | Rail pressure: 29.2 MPa | Cam synchronization: YES | Battery voltage: 11.0 V | Injector command present',injector_resistance:'One injector circuit measures open compared with the remaining injectors. The failure is repeatable.',injector_pulse:'Injector command is present at the ECU. One injector circuit does not carry current during cranking.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Customer Complaint',points:10,result:'Complaint verified: engine cranks at normal speed, does not start, and no exhaust smoke is present.'},
      {key:'visual_basic',category:'Visual Inspection',label:'Perform Basic Visual Inspection',points:0,result:'Battery terminals are clean and tight. Engine oil and coolant levels are normal. No obvious disconnected harnesses are visible.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read Active Fault Codes',points:10,result:'No active fault codes are stored.'},
      {key:'history',category:'Repair History',label:'Review Repair History',points:0,result:'No recent engine-control repairs. Fuel filters were serviced 42 operating hours ago.'},
      {key:'live_data',category:'Live Data',label:'View Cranking Live Data',points:15,result:'Cranking live data retrieved.'},
      {key:'rail_pressure',category:'Pressure Tests',label:'Check Rail Pressure While Cranking',points:0,result:'Rail-pressure test completed.'},
      {key:'cam_circuit',category:'Component Tests',label:'Check Cam Sensor Circuit',points:0,result:'Cam sensor connector and harness are intact. Power and ground are present. Signal must be tested while cranking.'},
      {key:'cam_meter',category:'Multimeter',label:'Meter Test — Cam Sensor Power / Ground / Signal',points:0,result:'Cam sensor circuit tested.'},
      {key:'ecu_power_ground',category:'Multimeter',label:'Meter Test — ECU Power / Ground',points:0,result:'ECU power and ground test completed.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review Engine-Control Wiring Diagram',points:0,result:'Wiring diagram reviewed for the related engine-control circuits.'},
      {key:'service_info',category:'Service Information',label:'Review Diagnostic Procedure',points:0,result:'Service procedure reviewed before component replacement.'},
      {key:'fuel_filter',category:'Component Tests',label:'Inspect Fuel Filter / Supply',points:0,result:'Fuel supply inspection completed.'},
      {key:'pump_control',category:'Component Tests',label:'Test High-Pressure Pump Control',points:0,result:'High-pressure pump control test completed.'},
      {key:'injector_resistance',category:'Component Tests',label:'Check Injector Resistance',points:0,result:'Injector electrical resistance test completed.'},
      {key:'injector_pulse',category:'Multimeter',label:'Check Injector Command / Current',points:0,result:'Injector command test completed.'},
      {key:'replace_cam_sensor',category:'Replace Part',label:'Replace Camshaft Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: camshaft position sensor replaced without proof of failure.'},
      {key:'replace_fuel_filter',category:'Replace Part',label:'Replace Fuel Filter',penalty:15,result:'PARTS CANNON PENALTY: fuel filter replaced without proof of restriction.'},
      {key:'replace_ecu',category:'Replace Part',label:'Replace ECU',penalty:15,result:'PARTS CANNON PENALTY: ECU replaced without proof of ECU failure.'},
      {key:'replace_hp_pump',category:'Replace Part',label:'Replace High-Pressure Pump',penalty:15,result:'PARTS CANNON PENALTY: high-pressure pump replaced without proof of failure.'},
      {key:'replace_injectors',category:'Replace Part',label:'Replace Injectors',penalty:15,result:'PARTS CANNON PENALTY: injectors replaced without proof of failure.'}
    ]
  },
  '6000-no-injector-activation':{
    key:'6000-no-injector-activation',series:'6000 Series',level:'Level 2',title:'Cranks, No Injector Activation',model:'Mahindra 6000 Series',workOrder:'SIM-NOINJECT-001',hours:638,complaint:'Engine cranks normally but will not start. FES shows no injector activation.',assignment:'Use voltage-drop testing, live data and circuit checks to prove the cause before replacing a component.',
    rootCauses:[
      {key:'ecu_fuse_resistance',diagnosis:'High resistance at the ECU supply fuse / fuse connection',repair:'Repair the high-resistance ECU power-supply connection and verify loaded ECU voltage, injector activation and engine starting',proof:['ecu_supply_loaded','fuse_drop'],points:{ecu_supply_loaded:20,fuse_drop:15},overrides:{live_data:'Engine RPM: 223 RPM | Rail pressure: 30.1 MPa | Cam sync: YES | ECU main voltage: 8.7 V while cranking | Injector activation: NO',ecu_supply_loaded:'Battery: 11.2 V cranking | ECU main feed at ECU: 8.7 V under load.',fuse_drop:'Voltage drop across ECU fuse/connection while cranking: 2.45 V. Specification: near 0 V.'}},
      {key:'crank_sensor',diagnosis:'Crankshaft position sensor signal failure',repair:'Repair/replace the crankshaft position sensor circuit and verify engine-speed signal and starting',replacementAction:'replace_crank_sensor',proof:['crank_circuit','crank_scope'],points:{crank_circuit:20,crank_scope:15},overrides:{live_data:'Engine RPM: 0 RPM while cranking | Rail pressure: 29.0 MPa | Cam status: detected | Injector activation: NO',crank_circuit:'Crank sensor power/ground and harness continuity are within specification.',crank_scope:'No crank sensor switching waveform is present at the ECU while cranking.'}},
      {key:'cam_sensor',diagnosis:'Camshaft position sensor signal failure',repair:'Repair/replace the camshaft position sensor circuit and verify synchronization and injector activation',replacementAction:'replace_cam_sensor',proof:['cam_circuit','cam_scope'],points:{cam_circuit:20,cam_scope:15},overrides:{live_data:'Engine RPM: 222 RPM | Rail pressure: 29.8 MPa | Cam synchronization: NO | Injector activation: NO',cam_circuit:'Cam sensor reference voltage and ground are correct; harness continuity to ECU is good.',cam_scope:'No usable camshaft position signal is present at the ECU during cranking.'}},
      {key:'ecu_ground',diagnosis:'Excessive voltage drop in ECU ground circuit',repair:'Repair the ECU ground connection and verify loaded ground voltage drop, injector activation and starting',proof:['ecu_ground_loaded','ground_bypass'],points:{ecu_ground_loaded:20,ground_bypass:15},overrides:{live_data:'Engine RPM: 221 RPM | Rail pressure: 30.0 MPa | Cam sync: YES | ECU voltage unstable | Injector activation: NO',ecu_ground_loaded:'ECU ground voltage drop while cranking: 1.18 V. Specification: less than 0.10 V.',ground_bypass:'Temporary approved ground bypass restores injector activation while cranking.'}},
      {key:'rail_pressure',diagnosis:'Insufficient common-rail pressure during cranking',repair:'Correct the fuel-pressure fault and verify actual rail pressure reaches starting threshold and engine starts',proof:['rail_pressure','fuel_supply'],points:{rail_pressure:20,fuel_supply:15},overrides:{live_data:'Engine RPM: 224 RPM | Actual rail pressure: 6.0 MPa | Desired rail pressure: 30 MPa | Cam sync: YES | Injector activation inhibited',rail_pressure:'Actual rail pressure remains well below desired pressure while cranking.',fuel_supply:'Low-pressure fuel supply is restricted and volume is below specification.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Customer Complaint',points:10,result:'Complaint verified. Engine cranks normally but does not start.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read FES Fault Codes',points:10,result:'No single fault code directly identifies the root cause.'},
      {key:'live_data',category:'Live Data',label:'Review FES Cranking Data',points:15,result:'Cranking live data retrieved.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review ECU Power / Sensor / Injector Diagram',points:0,result:'Relevant ECU power, grounds, crank/cam inputs and injector-control circuits identified.'},
      {key:'ecu_supply_loaded',category:'Multimeter',label:'Loaded ECU Supply Voltage Test',points:0,result:'ECU supply voltage tested while cranking.'},
      {key:'fuse_drop',category:'Multimeter',label:'Voltage Drop Across ECU Fuse / Connection',points:0,result:'Fuse and connection voltage-drop test completed under cranking load.'},
      {key:'crank_circuit',category:'Component Tests',label:'Check Crank Sensor Circuit',points:0,result:'Crank sensor circuit inspected and electrically tested.'},
      {key:'crank_scope',category:'Component Tests',label:'Check Crank Signal While Cranking',points:0,result:'Crank sensor signal test completed.'},
      {key:'cam_circuit',category:'Component Tests',label:'Check Cam Sensor Circuit',points:0,result:'Cam sensor circuit inspected and electrically tested.'},
      {key:'cam_scope',category:'Component Tests',label:'Check Cam Signal While Cranking',points:0,result:'Cam sensor signal test completed.'},
      {key:'ecu_ground_loaded',category:'Multimeter',label:'Loaded ECU Ground Voltage-Drop Test',points:0,result:'ECU ground tested under cranking load.'},
      {key:'ground_bypass',category:'Component Tests',label:'Perform Approved Ground Bypass Test',points:0,result:'Ground bypass test completed.'},
      {key:'rail_pressure',category:'Pressure Tests',label:'Compare Desired vs Actual Rail Pressure',points:0,result:'Rail pressure comparison completed.'},
      {key:'fuel_supply',category:'Pressure Tests',label:'Check Low-Pressure Fuel Supply',points:0,result:'Low-pressure fuel supply test completed.'},
      {key:'replace_crank_sensor',category:'Replace Part',label:'Replace Crankshaft Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: crank sensor replaced without proof.'},
      {key:'replace_cam_sensor',category:'Replace Part',label:'Replace Camshaft Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: cam sensor replaced without proof.'},
      {key:'replace_ecu',category:'Replace Part',label:'Replace ECU',penalty:15,result:'PARTS CANNON PENALTY: ECU replaced without proving power, ground, inputs and outputs.'},
      {key:'replace_hp_pump',category:'Replace Part',label:'Replace High-Pressure Pump',penalty:15,result:'PARTS CANNON PENALTY: high-pressure pump replaced without proof.'}
    ]
  },
  '3100-hst-no-forward':{
    key:'3100-hst-no-forward',series:'3100',level:'Level 2',title:'No Forward Travel',model:'Mahindra 3100',workOrder:'SIM-NOFWD-001',hours:286,complaint:'Tractor will move in reverse but will not travel forward. Engine operation is normal.',assignment:'Determine whether the failure is an input, controller, electrical output or hydraulic/mechanical problem.',
    rootCauses:[
      {key:'forward_solenoid',diagnosis:'Forward HST solenoid coil is open',repair:'Replace the failed forward HST solenoid and verify coil current and forward travel',replacementAction:'replace_forward_solenoid',proof:['solenoid_resistance','command_voltage'],points:{solenoid_resistance:20,command_voltage:15},overrides:{live_data:'Forward pedal input: 62% | Reverse pedal input: 0% | Forward command: ON | Forward solenoid current: 0 A',solenoid_resistance:'Forward solenoid coil: OL/open. Reverse solenoid coil: 8.4 Ω.',command_voltage:'Controller supplies battery voltage to the forward-solenoid connector when forward is commanded.'}},
      {key:'harness_open',diagnosis:'Open circuit between controller and forward HST solenoid',repair:'Repair the forward-solenoid harness/open connection and verify loaded voltage and forward travel',proof:['command_voltage','harness_continuity'],points:{command_voltage:20,harness_continuity:15},overrides:{live_data:'Forward pedal input: 61% | Forward command: ON | Forward solenoid current: 0 A',command_voltage:'Battery voltage is present at the controller output but 0 V is measured at the solenoid connector under command.',harness_continuity:'Forward-solenoid control wire is open between controller and solenoid connector.'}},
      {key:'pedal_input',diagnosis:'Forward pedal position input is not reaching the controller',repair:'Repair/calibrate the forward pedal input circuit and verify live-data response and forward travel',proof:['pedal_voltage','pedal_live'],points:{pedal_voltage:20,pedal_live:15},overrides:{live_data:'Forward pedal input: 0% even with pedal applied | Reverse input responds normally | Forward command: OFF',pedal_voltage:'Sensor supply and ground are correct; forward pedal signal remains fixed at 0.48 V through pedal travel.',pedal_live:'FMCU live data does not change from 0% as the forward pedal is moved.'}},
      {key:'controller_output',diagnosis:'FMCU/controller does not command the forward solenoid despite valid inputs',repair:'After proving powers, grounds, inputs and output circuit, repair/program/replace the controller and verify forward travel',replacementAction:'replace_controller',proof:['controller_inputs','controller_output_test'],points:{controller_inputs:20,controller_output_test:15},overrides:{live_data:'Forward pedal input: 64% | Neutral/safety inputs valid | Forward command: OFF despite valid request',controller_inputs:'Pedal, neutral/safety, speed and interlock inputs are all valid at the controller.',controller_output_test:'Forward-solenoid circuit load-tests correctly, but the controller never switches the output.'}},
      {key:'hydraulic',diagnosis:'Forward hydrostatic control pressure is not being produced',repair:'Repair the hydraulic/HST control fault and verify forward control pressure and travel',proof:['command_voltage','forward_pressure'],points:{command_voltage:15,forward_pressure:20},overrides:{live_data:'Forward pedal input: 63% | Forward command: ON | Forward solenoid current: normal',command_voltage:'Correct voltage and current are present at the forward HST solenoid.',forward_pressure:'Forward control pressure does not rise with the forward command; reverse control pressure is normal.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Forward / Reverse Complaint',points:10,result:'Reverse travel is normal. Forward travel is absent.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read FMCU Fault Codes',points:10,result:'No active code directly identifies the failed circuit.'},
      {key:'live_data',category:'Live Data',label:'View Pedal Inputs and HST Commands',points:15,result:'HST input/output live data retrieved.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review Forward HST Control Circuit',points:0,result:'Forward pedal, controller and forward-solenoid circuit identified.'},
      {key:'solenoid_resistance',category:'Multimeter',label:'Measure Forward Solenoid Resistance',points:0,result:'Forward solenoid resistance test completed.'},
      {key:'command_voltage',category:'Multimeter',label:'Measure Forward-Solenoid Command Voltage',points:0,result:'Forward-solenoid command voltage tested under load.'},
      {key:'harness_continuity',category:'Multimeter',label:'Check Forward-Solenoid Harness Continuity',points:0,result:'Harness continuity test completed.'},
      {key:'pedal_voltage',category:'Multimeter',label:'Test Forward Pedal Signal Voltage',points:0,result:'Forward pedal supply, ground and signal measured.'},
      {key:'pedal_live',category:'Live Data',label:'Sweep Forward Pedal While Watching Live Data',points:0,result:'Forward pedal live-data sweep completed.'},
      {key:'controller_inputs',category:'Component Tests',label:'Verify Controller Interlock Inputs',points:0,result:'Controller input conditions verified.'},
      {key:'controller_output_test',category:'Component Tests',label:'Load-Test Forward Controller Output Circuit',points:0,result:'Controller output circuit load test completed.'},
      {key:'forward_pressure',category:'Pressure Tests',label:'Check Forward HST Control Pressure',points:0,result:'Forward HST control pressure test completed.'},
      {key:'replace_forward_solenoid',category:'Replace Part',label:'Replace Forward HST Solenoid',penalty:15,result:'PARTS CANNON PENALTY: forward solenoid replaced without proof.'},
      {key:'replace_controller',category:'Replace Part',label:'Replace FMCU / Controller',penalty:15,result:'PARTS CANNON PENALTY: controller replaced without proof.'}
    ]
  },
  'can-network-down':{
    key:'can-network-down',series:'Electrical / CAN',level:'Level 3',title:'Multiple Modules Not Communicating',model:'Mahindra CAN-equipped Tractor',workOrder:'SIM-NETWORK-001',hours:521,complaint:'Multiple controllers are offline. Diagnostic tool cannot communicate with several modules.',assignment:'Use network resistance, voltage, isolation and power/ground testing to identify the failure.',
    rootCauses:[
      {key:'can_high_open',diagnosis:'Open circuit in CAN High',repair:'Repair the CAN High open and verify network resistance, bias voltage and module communication',proof:['network_resistance','can_continuity'],points:{network_resistance:15,can_continuity:20},overrides:{network_resistance:'Key OFF network resistance: approximately 120 Ω, indicating one termination path is missing from the measured network.',can_voltage:'Key ON: CAN High approximately 2.5 V and CAN Low approximately 2.5 V with little differential activity.',can_continuity:'CAN High is open between the backbone junction and rear-controller branch. CAN Low continuity is normal.'}},
      {key:'can_low_short',diagnosis:'CAN Low shorted to ground',repair:'Repair the CAN Low short to ground and verify bias voltage, waveform and communication',proof:['can_voltage','isolation'],points:{can_voltage:15,isolation:20},overrides:{network_resistance:'Key OFF resistance is abnormal and unstable.',can_voltage:'Key ON: CAN High 2.6 V | CAN Low 0.1 V.',isolation:'Disconnecting the rear harness branch restores normal CAN bias voltage and communication.'}},
      {key:'terminator_missing',diagnosis:'One 120-ohm CAN terminating resistor is missing/open',repair:'Restore the missing/open termination and verify approximately 60 Ω key-off resistance and reliable communication',proof:['network_resistance','terminator_check'],points:{network_resistance:20,terminator_check:15},overrides:{network_resistance:'Key OFF network resistance: 119.8 Ω.',terminator_check:'One end of the network measures 120 Ω termination; the opposite terminating resistor is open/missing.'}},
      {key:'module_bus_down',diagnosis:'A failed module is pulling the CAN network down',repair:'Replace/repair the failed module after isolation proves it is loading the bus; verify network communication',replacementAction:'replace_suspect_module',proof:['can_voltage','isolation'],points:{can_voltage:15,isolation:20},overrides:{network_resistance:'Key OFF network resistance is lower than expected.',can_voltage:'Key ON CAN bias voltages are collapsed and communication is intermittent.',isolation:'Network communication returns immediately when the rear controller is disconnected. Powers and grounds to that module are correct.'}},
      {key:'module_power',diagnosis:'Offline module has lost power or ground; CAN network itself is healthy',repair:'Repair the module power/ground supply and verify module wake-up and network communication',proof:['network_resistance','module_power_ground'],points:{network_resistance:15,module_power_ground:20},overrides:{network_resistance:'Key OFF network resistance: 60.4 Ω. Backbone termination is normal.',can_voltage:'CAN High/CAN Low bias and activity are normal at the diagnostic connector.',module_power_ground:'The offline controller has no ignition feed. Ground voltage drop is normal.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Communication Complaint',points:10,result:'Several modules are offline; communication complaint verified.'},
      {key:'fault_codes',category:'Fault Codes',label:'Perform Full Network Scan',points:10,result:'Communication DTCs are present in modules that remain online.'},
      {key:'live_data',category:'Live Data',label:'Identify Online vs Offline Modules',points:15,result:'Network population and missing modules recorded.'},
      {key:'network_resistance',category:'Multimeter',label:'Measure CAN Resistance Key OFF',points:0,result:'Key-off CAN resistance test completed.'},
      {key:'can_voltage',category:'Multimeter',label:'Measure CAN High / CAN Low Bias Voltage',points:0,result:'CAN bias voltages measured.'},
      {key:'can_continuity',category:'Multimeter',label:'Check CAN High / Low Continuity by Branch',points:0,result:'Network branch continuity test completed.'},
      {key:'terminator_check',category:'Component Tests',label:'Check Both 120-ohm Terminators',points:0,result:'CAN terminating resistors checked individually.'},
      {key:'isolation',category:'Component Tests',label:'Isolate Network Branches / Modules',points:0,result:'Network branches isolated one at a time while communication is monitored.'},
      {key:'module_power_ground',category:'Multimeter',label:'Load-Test Suspect Module Power and Ground',points:0,result:'Module power and ground circuits load-tested.'},
      {key:'wiring',category:'Wiring Diagram',label:'Review CAN Backbone and Branch Diagram',points:0,result:'Network topology and termination locations identified.'},
      {key:'replace_suspect_module',category:'Replace Part',label:'Replace Suspect Controller',penalty:15,result:'PARTS CANNON PENALTY: controller replaced before network isolation and power/ground proof.'}
    ]
  },
  '6075-shuttle-reverse':{
    key:'6075-shuttle-reverse',series:'6000 / PST',level:'Level 3',title:'Delayed / No Reverse',model:'Mahindra 6075 Power Shuttle',workOrder:'SIM-PST-001',hours:744,complaint:'Forward engagement is normal. Reverse is delayed and may fail to engage when hot.',assignment:'Separate electrical command, inching/interlock and hydraulic clutch-pressure causes before repair.',
    rootCauses:[
      {key:'reverse_solenoid',diagnosis:'Reverse clutch solenoid electrical failure',repair:'Repair/replace the reverse solenoid circuit and verify current, pressure rise and reverse engagement',replacementAction:'replace_reverse_solenoid',proof:['solenoid_resistance','reverse_command'],points:{solenoid_resistance:20,reverse_command:15},overrides:{live_data:'Shuttle lever: REVERSE | Inching input: released | Reverse command: ON | Reverse solenoid current: 0 A',solenoid_resistance:'Reverse solenoid coil is open. Forward solenoid resistance is within specification.',reverse_command:'Battery voltage is present at the reverse solenoid connector when reverse is commanded.'}},
      {key:'inching_switch',diagnosis:'Inching pedal switch/sensor remains active and inhibits reverse engagement',repair:'Adjust/repair the inching pedal switch/sensor and verify released status and normal reverse engagement',proof:['inching_live','inching_adjustment'],points:{inching_live:20,inching_adjustment:15},overrides:{live_data:'Shuttle lever: REVERSE | Inching input: ACTIVE with pedal released | Reverse command: inhibited',inching_live:'Live data continues to show inching active with the pedal fully released.',inching_adjustment:'Physical switch/sensor adjustment is out of specification and changes state when manually repositioned.'}},
      {key:'hydraulic_pressure',diagnosis:'Reverse clutch apply pressure is below specification',repair:'Repair the hydraulic pressure loss and verify reverse clutch pressure and engagement hot and cold',proof:['reverse_pressure','forward_compare'],points:{reverse_pressure:20,forward_compare:15},overrides:{live_data:'Electrical reverse command and solenoid current are normal.',reverse_pressure:'Reverse clutch pressure rises slowly and remains below specification when hot.',forward_compare:'Forward clutch pressure is normal under the same operating conditions.'}},
      {key:'harness_drop',diagnosis:'Excessive voltage drop in reverse-solenoid feed circuit',repair:'Repair the high-resistance reverse-solenoid feed/connection and verify loaded voltage, current and engagement',proof:['reverse_command','loaded_drop'],points:{reverse_command:15,loaded_drop:20},overrides:{live_data:'Reverse command: ON | Reverse solenoid current: low/intermittent',reverse_command:'Controller output is correct at the source, but voltage at the solenoid falls under load.',loaded_drop:'Loaded voltage drop between controller and reverse solenoid is 3.1 V.'}},
      {key:'clutch_internal',diagnosis:'Internal reverse clutch leakage / mechanical failure',repair:'Repair the reverse clutch pack/internal sealing fault and verify pressure retention and reverse engagement',proof:['reverse_pressure','leak_test'],points:{reverse_pressure:15,leak_test:20},overrides:{live_data:'All electrical commands, inputs and solenoid current are normal.',reverse_pressure:'Reverse apply pressure initially rises but decays rapidly.',leak_test:'Hydraulic leakage test indicates excessive internal leakage in the reverse clutch circuit.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Reverse Engagement Complaint',points:10,result:'Forward is normal; reverse is delayed and worse when warm.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read Transmission / Shuttle Fault Codes',points:10,result:'No active code directly identifies the root cause.'},
      {key:'live_data',category:'Live Data',label:'Review Shuttle and Inching Live Data',points:15,result:'Transmission input/output live data retrieved.'},
      {key:'solenoid_resistance',category:'Multimeter',label:'Measure Reverse Solenoid Resistance',points:0,result:'Reverse solenoid resistance test completed.'},
      {key:'reverse_command',category:'Multimeter',label:'Check Reverse-Solenoid Command Voltage',points:0,result:'Reverse-solenoid command voltage measured.'},
      {key:'inching_live',category:'Live Data',label:'Monitor Inching Input Released / Applied',points:0,result:'Inching input state monitored through pedal travel.'},
      {key:'inching_adjustment',category:'Component Tests',label:'Inspect Inching Pedal Switch / Adjustment',points:0,result:'Inching switch/sensor adjustment inspected.'},
      {key:'reverse_pressure',category:'Pressure Tests',label:'Measure Reverse Clutch Pressure',points:0,result:'Reverse clutch apply pressure measured.'},
      {key:'forward_compare',category:'Pressure Tests',label:'Compare Forward Clutch Pressure',points:0,result:'Forward clutch pressure measured for comparison.'},
      {key:'loaded_drop',category:'Multimeter',label:'Loaded Voltage-Drop Test — Reverse Circuit',points:0,result:'Reverse-solenoid feed circuit voltage drop tested under load.'},
      {key:'leak_test',category:'Pressure Tests',label:'Perform Reverse Clutch Leakage Test',points:0,result:'Reverse clutch hydraulic leakage test completed.'},
      {key:'replace_reverse_solenoid',category:'Replace Part',label:'Replace Reverse Solenoid',penalty:15,result:'PARTS CANNON PENALTY: reverse solenoid replaced without proof.'}
    ]
  },
  '5145-hitch-low':{
    key:'5145-hitch-low',series:'5000 Series',level:'Level 2',title:'Three-Point Hitch Raises Only About One Foot',model:'Mahindra 5155',workOrder:'SIM-5155-001',hours:367,complaint:'Three-point hitch raises from the bottom but stops after approximately one foot of travel.',assignment:'Determine whether the limitation comes from command/calibration, feedback, hydraulics or mechanical linkage.',
    rootCauses:[
      {key:'position_sensor',diagnosis:'Hitch position sensor is misadjusted / feedback reaches full-scale too early',repair:'Adjust/calibrate the hitch position sensor and verify full hitch travel and correct position feedback',proof:['position_live','sensor_voltage'],points:{position_live:20,sensor_voltage:15},overrides:{live_data:'Hitch command: 100% | Hitch position feedback: 100% when arms are only about one-third raised | Raise output: OFF',position_live:'Feedback rises to 100% long before the hitch reaches full mechanical height.',sensor_voltage:'Position sensor signal reaches the upper limit prematurely; supply and ground are correct.'}},
      {key:'calibration',diagnosis:'Hitch controller calibration is incorrect/corrupted',repair:'Perform the specified hitch calibration and verify commanded vs actual position through full travel',proof:['position_live','calibration_check'],points:{position_live:15,calibration_check:20},overrides:{live_data:'Position sensor voltage changes smoothly, but learned lower/upper limits do not correspond to actual hitch travel.',calibration_check:'Stored hitch endpoint values are outside expected range. Sensor electrical sweep is normal.'}},
      {key:'raise_solenoid',diagnosis:'Raise-control solenoid/valve does not maintain commanded flow',repair:'Repair/replace the raise-control solenoid/valve after electrical and hydraulic proof; verify full hitch travel',replacementAction:'replace_raise_solenoid',proof:['raise_command','solenoid_current'],points:{raise_command:15,solenoid_current:20},overrides:{live_data:'Hitch command remains 100% | Position feedback 35% | Raise command ON | Hitch stops raising',raise_command:'Controller continues commanding raise after movement stops.',solenoid_current:'Command voltage is present but raise-solenoid current is abnormal and coil resistance is out of specification.'}},
      {key:'hydraulic_pressure',diagnosis:'Insufficient hitch hydraulic pressure / flow under load',repair:'Repair the hydraulic supply/pressure fault and verify lift capacity and full hitch travel',proof:['hitch_pressure','flow_test'],points:{hitch_pressure:20,flow_test:15},overrides:{live_data:'Hitch command and position feedback remain valid. Raise output remains ON.',hitch_pressure:'Hitch lift pressure is below specification as the arms stop moving.',flow_test:'Hydraulic flow to the hitch circuit drops below specification under load.'}},
      {key:'mechanical_linkage',diagnosis:'Mechanical linkage/interference prevents full hitch travel',repair:'Correct the binding/misadjusted mechanical linkage and verify unrestricted full hitch travel',proof:['visual_linkage','manual_linkage'],points:{visual_linkage:20,manual_linkage:15},overrides:{live_data:'Hitch command remains ON and feedback indicates partial travel.',visual_linkage:'Linkage inspection shows interference/binding near the point where the hitch stops.',manual_linkage:'With hydraulic force removed, the linkage does not move freely through the full expected range.'}}
    ],
    actions:[
      {key:'verify_complaint',category:'Visual Inspection',label:'Verify Hitch Travel Complaint',points:10,result:'Hitch raises approximately one foot and then stops.'},
      {key:'fault_codes',category:'Fault Codes',label:'Read Hitch / Controller Fault Codes',points:10,result:'No active code directly identifies the root cause.'},
      {key:'live_data',category:'Live Data',label:'Review Hitch Command and Position Feedback',points:15,result:'Hitch live data retrieved.'},
      {key:'position_live',category:'Live Data',label:'Sweep Hitch Through Available Travel',points:0,result:'Position-feedback response monitored.'},
      {key:'sensor_voltage',category:'Multimeter',label:'Measure Hitch Position Sensor Signal',points:0,result:'Position sensor supply, ground and signal measured.'},
      {key:'calibration_check',category:'Service Information',label:'Check Stored Hitch Calibration / Endpoints',points:0,result:'Hitch calibration values reviewed.'},
      {key:'raise_command',category:'Multimeter',label:'Check Raise-Solenoid Command Voltage',points:0,result:'Raise-solenoid command voltage measured while hitch stops.'},
      {key:'solenoid_current',category:'Component Tests',label:'Check Raise Solenoid Coil / Current',points:0,result:'Raise-solenoid electrical test completed.'},
      {key:'hitch_pressure',category:'Pressure Tests',label:'Measure Hitch Lift Pressure',points:0,result:'Hitch lift pressure measured under load.'},
      {key:'flow_test',category:'Pressure Tests',label:'Check Hydraulic Flow to Hitch Circuit',points:0,result:'Hydraulic flow test completed.'},
      {key:'visual_linkage',category:'Visual Inspection',label:'Inspect Hitch Linkage for Binding / Interference',points:0,result:'Hitch linkage inspected through available travel.'},
      {key:'manual_linkage',category:'Component Tests',label:'Check Linkage Freedom of Movement',points:0,result:'Mechanical linkage freedom-of-movement test completed.'},
      {key:'replace_raise_solenoid',category:'Replace Part',label:'Replace Hitch Raise Solenoid',penalty:15,result:'PARTS CANNON PENALTY: raise solenoid replaced without proof.'},
      {key:'replace_position_sensor',category:'Replace Part',label:'Replace Hitch Position Sensor',penalty:15,result:'PARTS CANNON PENALTY: position sensor replaced without proof.'}
    ]
  }
};

const ALL_TRACTOR_MODELS = [
  '1100','1120','2100','2126',
  '1526','1533','1538','1626','1635','1640',
  '2310','2500','2600','2638','2660',
  '3100','4100','4500','4600','5100','5155','5500',
  '6065','6075','6530','7085','7000','8000','9110','9125',
  'mForce 105'
];
function tractorChoicesForSim(sim){ return ALL_TRACTOR_MODELS; }
function validTractorForSim(sim,model){ return tractorChoicesForSim(sim).includes(model); }
function simulationDisplayTitle(sim,model){
  return sim.title;
}
function simByKey(key){ return DIAGNOSTIC_SIMULATIONS[key]||null; }
function rootCauseByKey(sim,key){ return sim?.rootCauses?.find(x=>x.key===key)||null; }
function simForRoot(key,rootKey){
  const base=simByKey(key), root=rootCauseByKey(base,rootKey); if(!base||!root) return null;
  return {...base,correctDiagnosis:root.diagnosis,correctRepair:root.repair,rootCauseKey:root.key,rootCause:root,actions:base.actions.map(a=>({...a,points:(a.key==='verify_complaint'||a.key==='fault_codes'||a.key==='live_data')?(a.points||0):(root.points?.[a.key]||0),result:(root.overrides?.[a.key]||a.result)}))};
}
async function getSimulationAssignment(classId,simulationKey){
  const q=await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1 AND simulation_key=$2 AND enabled=true`,[classId,simulationKey]); return q.rows[0]||null;
}
function elapsedText(start){ const sec=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000)); const m=Math.floor(sec/60),ss=String(sec%60).padStart(2,'0'); return `${m}:${ss}`; }
async function getSimAttemptForStudent(studentId,attemptId){
  const q=await pool.query(`SELECT * FROM simulation_attempts WHERE id=$1 AND student_id=$2`,[attemptId,studentId]); return q.rows[0];
}
async function recalcSimulation(attemptId){
  const a=(await pool.query(`SELECT COALESCE(sum(points),0)::int positive,COALESCE(sum(penalty),0)::int penalty FROM simulation_actions WHERE attempt_id=$1`,[attemptId])).rows[0];
  const attempt=(await pool.query('SELECT diagnosis_correct,repair_correct FROM simulation_attempts WHERE id=$1',[attemptId])).rows[0]||{};
  const positive=Number(a.positive)+(attempt.diagnosis_correct?20:0)+(attempt.repair_correct?10:0);
  const penalty=Number(a.penalty); const score=Math.max(0,Math.min(100,positive-penalty));
  await pool.query('UPDATE simulation_attempts SET positive_points=$1,penalty_points=$2,score=$3 WHERE id=$4',[positive,penalty,score,attemptId]);
  return {positive,penalty,score};
}
function simulationCss(){ return `<style>
  .sim-shell{display:grid;grid-template-columns:320px 1fr;gap:18px}.sim-wo{background:#151515;color:#fff;border-radius:18px;padding:20px;border-top:6px solid var(--red);position:sticky;top:12px;height:max-content}.sim-wo h2{margin:6px 0 12px}.sim-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.sim-meta div{background:#272727;border-radius:10px;padding:10px}.sim-meta span{display:block;color:#bbb;font-size:11px;text-transform:uppercase;font-weight:800}.sim-meta b{display:block;margin-top:3px}.sim-score{font-size:42px;font-weight:900}.sim-tools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sim-tool{border:1px solid #ddd;border-radius:14px;padding:13px;background:#fff}.sim-tool h3{margin:0 0 8px;font-size:15px}.sim-tool form{margin:6px 0}.sim-tool button{width:100%;font-size:13px;padding:9px}.sim-tool button.sim-choice-good{background:#237a3b!important;border-color:#237a3b!important;color:#fff!important;opacity:1!important}.sim-tool button.sim-choice-wrong{background:#b5121b!important;border-color:#b5121b!important;color:#fff!important;opacity:1!important}.sim-tool button.sim-choice-neutral{background:#ececec!important;border-color:#cfcfcf!important;color:#333!important;opacity:1!important}.sim-path-key{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12px;font-weight:800}.sim-path-key span{display:inline-flex;align-items:center;gap:6px}.sim-path-key i{width:12px;height:12px;border-radius:3px;display:inline-block}.sim-path-key .g i{background:#237a3b}.sim-path-key .r i{background:#b5121b}.sim-path-key .n i{background:#bdbdbd}.sim-log{border-left:5px solid #222;background:#fafafa;padding:12px 15px;border-radius:8px;margin:9px 0}.sim-log.good{border-color:#267a3f}.sim-log.penalty{border-color:#b5121b;background:#fff4f4}.sim-final{border:3px solid var(--red);background:#fffafa}.parts-penalty{background:#5c0a0f;color:#fff;border-radius:10px;padding:10px;font-weight:800}.sim-badge{display:inline-block;background:#eee;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800}.sim-timer{font-variant-numeric:tabular-nums}.sim-history td,.sim-history th{white-space:nowrap}@media(max-width:900px){.sim-shell{grid-template-columns:1fr}.sim-wo{position:static}.sim-tools{grid-template-columns:1fr}}
</style>`; }


async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS classes(
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, course TEXT NOT NULL,
    instructor TEXT NOT NULL, pass_score INTEGER NOT NULL DEFAULT 80, hours NUMERIC(5,2) NOT NULL DEFAULT 8,
    join_token TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), active BOOLEAN DEFAULT TRUE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS students(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL, dealer TEXT NOT NULL, joined_at TIMESTAMPTZ DEFAULT now(), UNIQUE(class_id,name,dealer)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    activity TEXT NOT NULL, score INTEGER NOT NULL, details JSONB DEFAULT '{}'::jsonb, completed_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS skills(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    skill TEXT NOT NULL, signed_off BOOLEAN DEFAULT FALSE, signed_by TEXT, signed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS instructor_notes(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    comments TEXT DEFAULT '', certification_status TEXT DEFAULT 'Pending', certificate_no TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_questions(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    question TEXT NOT NULL, choices JSONB NOT NULL, answer_index INTEGER NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_stations(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    station_name TEXT NOT NULL, task TEXT NOT NULL, expected TEXT NOT NULL
  )`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS hunt_tractor_count INTEGER NOT NULL DEFAULT 3`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS hunt_items_per_tractor INTEGER NOT NULL DEFAULT 5`);
  await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS tractor_no INTEGER`);
  await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS tractor_model TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE hunt_stations ADD COLUMN IF NOT EXISTS item_label TEXT DEFAULT ''`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_tractors(class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE, tractor_no INTEGER NOT NULL, model TEXT NOT NULL DEFAULT '', PRIMARY KEY(class_id,tractor_no))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_progress(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    station_id INTEGER REFERENCES hunt_stations(id) ON DELETE CASCADE,
    answer TEXT DEFAULT '', correct BOOLEAN DEFAULT FALSE, completed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id,station_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_status(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    activity TEXT DEFAULT 'Joined', status TEXT DEFAULT 'Joined', progress INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0, current_score INTEGER, updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_feedback(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    overall INTEGER NOT NULL, instructor INTEGER NOT NULL, usefulness INTEGER NOT NULL,
    hands_on INTEGER NOT NULL, difficulty INTEGER NOT NULL,
    most_helpful TEXT DEFAULT '', improve TEXT DEFAULT '', comments TEXT DEFAULT '', submitted_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_progress(
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
    is_correct BOOLEAN DEFAULT FALSE, selected_answer INTEGER, updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(student_id,question_id)
  )`);
  await pool.query(`ALTER TABLE quiz_progress ADD COLUMN IF NOT EXISTS selected_answer INTEGER`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_attempts(
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    score INTEGER, correct_count INTEGER DEFAULT 0, total_questions INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_attempt_answers(
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    source_question_id INTEGER, display_order INTEGER NOT NULL,
    question_text TEXT NOT NULL, choices JSONB NOT NULL,
    selected_index INTEGER, selected_answer TEXT,
    correct_index INTEGER NOT NULL, correct_answer TEXT NOT NULL,
    explanation TEXT DEFAULT '', topic TEXT DEFAULT '', is_correct BOOLEAN,
    UNIQUE(attempt_id,display_order)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id,completed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt ON quiz_attempt_answers(attempt_id,display_order)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS simulation_attempts(
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    simulation_key TEXT NOT NULL, title TEXT NOT NULL, work_order TEXT NOT NULL,
    score INTEGER DEFAULT 0, positive_points INTEGER DEFAULT 0, penalty_points INTEGER DEFAULT 0,
    final_diagnosis TEXT, final_repair TEXT, diagnosis_correct BOOLEAN DEFAULT FALSE, repair_correct BOOLEAN DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'in_progress', started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS simulation_actions(
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL REFERENCES simulation_attempts(id) ON DELETE CASCADE,
    action_key TEXT NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL, result_text TEXT NOT NULL,
    points INTEGER DEFAULT 0, penalty INTEGER DEFAULT 0, sequence INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(attempt_id,action_key)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sim_attempts_student ON simulation_attempts(student_id,completed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sim_actions_attempt ON simulation_actions(attempt_id,sequence)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS simulation_assignments(
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    simulation_key TEXT NOT NULL,
    root_cause_key TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    configured_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(class_id,simulation_key)
  )`);
  await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS root_cause_key TEXT`);
  await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS assigned_diagnosis TEXT`);
  await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS assigned_repair TEXT`);
  await pool.query(`ALTER TABLE simulation_attempts ADD COLUMN IF NOT EXISTS tractor_model TEXT`);
  await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS tractor_model TEXT`);
  await pool.query(`ALTER TABLE simulation_assignments ADD COLUMN IF NOT EXISTS technician_limit INTEGER DEFAULT 15`);
  await pool.query(`UPDATE simulation_assignments SET technician_limit=15 WHERE technician_limit IS NULL`);
  await pool.query(`UPDATE simulation_assignments SET tractor_model='3100' WHERE tractor_model='3100 HST'`);
  // Migrate the former OJA simulation key to the 3100 HST simulation key.
  await pool.query(`UPDATE simulation_attempts SET simulation_key='3100-hst-no-forward' WHERE simulation_key='oja-no-forward'`);
  await pool.query(`UPDATE simulation_assignments SET simulation_key='3100-hst-no-forward' WHERE simulation_key='oja-no-forward' AND NOT EXISTS (SELECT 1 FROM simulation_assignments sa2 WHERE sa2.class_id=simulation_assignments.class_id AND sa2.simulation_key='3100-hst-no-forward')`);
  await pool.query(`DELETE FROM simulation_assignments WHERE simulation_key='oja-no-forward'`);
  await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS explanation TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS show_live_scores BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS student_feedback BOOLEAN DEFAULT TRUE`);

  await pool.query(`CREATE TABLE IF NOT EXISTS course_catalog(
    id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS site_settings(
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`);
  const defaults=['Fifty One Hundred Refresh','Six Thousand Series','3100','SU Series','ROXOR','Electrical Fundamentals','CAN / J1939 Diagnostics','FES / GARUDA Diagnostics'];
  for (const name of defaults) await pool.query('INSERT INTO course_catalog(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[name]);
  const settings={home_message:'Start classes, build activities, watch technicians, and print training records.',certificate_title:'Certificate of Completion',organization_name:'Mahindra Technician Training'};
  for (const [key,value] of Object.entries(settings)) await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[key,value]);
}
await init();

app.get('/health', (req,res)=>res.json({ok:true}));
app.get('/', (req,res)=>res.send(layout('Training Hub', `<div class="grid"><div class="card"><div class="big">Instructor</div><p>Create classes, show the QR code, watch results, sign off skills, and print student reports.</p><a class="btn" href="/instructor">Open Instructor Dashboard</a></div><div class="card"><div class="big">Technician</div><p>Scan the class QR code or enter the class code from your instructor.</p><a class="btn alt" href="/join">Join Training</a></div></div>`)));

app.get('/join', (req,res)=>res.send(layout('Join Training', `<div class="card"><div class="big">Join a Training Class</div><form method="get" action="/join-code"><label>6-Digit Class Code<input name="code" inputmode="numeric" maxlength="6" required></label><button>Continue</button></form></div>`)));
app.get('/join-code', async(req,res)=>{
  const code=(req.query.code||'').trim(); const c=await pool.query('SELECT * FROM classes WHERE code=$1 AND active=true',[code]);
  if(!c.rowCount) return res.send(layout('Class Not Found', `<div class="card"><div class="big">Class not found</div><p>Check the class code with your instructor.</p><a class="btn" href="/join">Try Again</a></div>`));
  res.redirect('/c/'+c.rows[0].join_token);
});

app.get('/c/:token', async(req,res)=>{
  const q=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]);
  if(!q.rowCount) return res.status(404).send(layout('Class Closed','<div class="card">This class is not available.</div>'));
  const c=q.rows[0];
  res.send(layout('Join '+c.course, `<div class="card"><span class="pill">Class ${esc(c.code)}</span><div class="big" style="margin-top:10px">${esc(c.course)}</div><p>Instructor: ${esc(c.instructor)}</p><form method="post" action="/c/${esc(c.join_token)}/join"><label>Your Name<input name="name" required autocomplete="name"></label><label>Dealership<input name="dealer" required></label><button>Join Class</button></form></div>`));
});
app.post('/c/:token/join', async(req,res)=>{
  const cq=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]); if(!cq.rowCount) return res.status(404).send('Class closed');
  const c=cq.rows[0], name=(req.body.name||'').trim(), dealer=(req.body.dealer||'').trim(); if(!name||!dealer) return res.status(400).send('Name and dealer required');
  let s=await pool.query('SELECT * FROM students WHERE class_id=$1 AND lower(name)=lower($2) AND lower(dealer)=lower($3)',[c.id,name,dealer]);
  if(!s.rowCount) s=await pool.query('INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) RETURNING *',[c.id,name,dealer]);
  const student=s.rows[0];
  const skills=['Verify customer complaint','Battery / power supply check','CAN network resistance check','Use GARUDA or approved diagnostic tool','Verify inputs and outputs','Document proof of failure'];
  for(const sk of skills) await pool.query('INSERT INTO skills(student_id,skill) VALUES($1,$2) ON CONFLICT DO NOTHING',[student.id,sk]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,updated_at) VALUES($1,'Joined','Joined',0,0,now()) ON CONFLICT(student_id) DO UPDATE SET updated_at=now()`,[student.id]);
  res.setHeader('Set-Cookie',`mth_student_${c.id}=${student.id}:${c.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  res.redirect(`/student/${student.id}?token=${encodeURIComponent(c.join_token)}`);
});

async function studentContext(id,token){
  const q=await pool.query(`SELECT s.*,c.course,c.code,c.instructor,c.join_token,c.pass_score,c.hours,c.hunt_tractor_count FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1 AND c.join_token=$2`,[id,token]); return q.rows[0];
}
app.get('/student/:id', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const r=await pool.query('SELECT activity,score FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]);
  const done=new Set(r.rows.map(x=>x.activity));
  const quizResults=r.rows.filter(x=>x.activity==='Module Quiz');
  const quizScore=quizResults.length?quizResults[quizResults.length-1].score:null;
  const passedQuiz=quizScore!==null && quizScore>=s.pass_score;
  if(passedQuiz) await ensureCertificate(s.id);
  const feedback=(await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount>0;
  const simAssignments=(await pool.query(`SELECT simulation_key,root_cause_key FROM simulation_assignments WHERE class_id=$1 AND enabled=true`,[s.class_id])).rows;
  const releasedSimCount=simAssignments.filter(x=>!!simByKey(x.simulation_key)).length;
  const allCore=['Module Quiz','Scavenger Hunt','Failure Simulation'].every(x=>done.has(x));
  const certificateCard=quizScore===null?`<div class="card"><div class="big">Certificate</div><p class="muted">Your certificate will appear here after you complete and pass the test.</p></div>`:passedQuiz?`<div class="card" style="border:3px solid var(--red);background:#fffafa"><div class="eyebrow">Course Completed</div><div class="big">Your Certificate Is Ready</div><p>You scored <b>${quizScore}%</b>. Open, print, or save your certificate now.</p><a class="btn" href="/student/${s.id}/certificate?token=${encodeURIComponent(s.join_token)}" target="_blank">View My Certificate</a></div>`:`<div class="card"><div class="big">Certificate</div><div class="alert">Your test score is ${quizScore}%. A score of ${s.pass_score}% is required before the certificate is available.</div></div>`;
  res.send(layout('Technician Home', `<div style="background:linear-gradient(135deg,#171717,#3a080b);color:white;border-radius:18px;padding:24px;margin-bottom:18px;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#f0b8bb">Technician Training Portal · v5.6</div><div class="big" style="font-size:30px">Welcome, ${esc(s.name)}</div><p style="margin-bottom:0">${esc(s.course)} · ${esc(s.dealer)} · Class ${esc(s.code)}</p></div>${certificateCard}<div class="grid"><div class="card"><div class="big">Module Quiz</div><p>Knowledge test. Your instructor can watch your progress while you work.</p>${done.has('Module Quiz')?`<div class="success">Latest Score · ${quizScore}%</div><div class="toolbar" style="margin-top:10px"><a class="btn light" href="/student/${s.id}/quiz-review?token=${encodeURIComponent(s.join_token)}">Review Latest Answers</a><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a></div>`:`<a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a>`}</div><div class="card"><div class="big">QR Scavenger Hunt</div><p>Scan the QR code posted at each training station.</p>${done.has('Scavenger Hunt')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">View Hunt Progress</a>`}</div><div class="card"><div class="big">Diagnostic Simulation Library</div><p>Choose from the diagnostic failures your instructor has released for this class.</p>${releasedSimCount===0?`<div class="alert"><b>Waiting for Instructor</b><br>No diagnostic simulation has been released yet.</div>`:`<div class="success"><b>${releasedSimCount}</b> simulation${releasedSimCount===1?'':'s'} available</div><a class="btn" style="margin-top:10px" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Open Simulation Library</a>`}</div><div class="card"><div class="big">Training Feedback</div><p>Tell us what helped and what should be improved.</p>${feedback?'<div class="success">Feedback Submitted — Thank You</div>':allCore?`<a class="btn" href="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">Give Training Feedback</a>`:'<div class="muted">Available after the training activities are finished.</div>'}</div></div>`));
});

app.get('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  let q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  if(!q.rowCount){
    for(const x of DEFAULT_QUIZ) await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[s.class_id,x[0],JSON.stringify(x[1]),x[2],'Review the correct diagnostic principle for this question.','General Diagnostics']);
    q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  }
  const attempt=(await pool.query(`INSERT INTO quiz_attempts(student_id,class_id,total_questions,status,started_at) VALUES($1,$2,$3,'in_progress',now()) RETURNING *`,[s.id,s.class_id,q.rowCount])).rows[0];
  for(let i=0;i<q.rows.length;i++){
    const x=q.rows[i], choices=Array.isArray(x.choices)?x.choices:[];
    await pool.query(`INSERT INTO quiz_attempt_answers(attempt_id,source_question_id,display_order,question_text,choices,correct_index,correct_answer,explanation,topic) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[attempt.id,x.id,i+1,x.question,JSON.stringify(choices),x.answer_index,choices[x.answer_index]||'',x.explanation||'Review this topic with your instructor.',x.topic||'']);
  }
  await pool.query('DELETE FROM quiz_progress WHERE student_id=$1',[s.id]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',0,$2,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=0,total=$2,current_score=NULL,updated_at=now()`,[s.id,q.rowCount]);
  const ids=q.rows.map(x=>x.id).join(',');
  const qs=q.rows.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.question)}</b>${x.choices.map((c,j)=>`<label><input type="radio" name="q_${x.id}" value="${j}" required data-qid="${x.id}">${String.fromCharCode(65+j)}. ${esc(c)}</label>`).join('')}</div>`).join('');
  res.send(layout('Quiz', `<div class="card"><div class="eyebrow">Permanent Attempt Record · v5.6</div><div class="big">${esc(s.course)} — Module Quiz</div><p class="muted">This attempt is saved as a permanent record, including every question, your selected answer, the correct answer, and explanation.</p><form id="quizForm" method="post" action="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="ids" value="${ids}"><input type="hidden" name="attempt_id" value="${attempt.id}">${qs}<button>Submit Quiz</button></form></div>`, `<script>const answered=new Set();document.querySelectorAll('input[type=radio][data-qid]').forEach(el=>el.addEventListener('change',async()=>{answered.add(el.dataset.qid);try{await fetch('/student/${s.id}/quiz-progress?token=${encodeURIComponent(s.join_token)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt_id:${attempt.id},qid:Number(el.dataset.qid),answer:Number(el.value),progress:answered.size,total:${q.rowCount}})});}catch(e){}}));</script>`));
});

app.post('/student/:id/quiz-progress', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).json({ok:false});
  const attemptId=Number(req.body.attempt_id), qid=Number(req.body.qid), answer=Number(req.body.answer);
  const a=(await pool.query(`SELECT qa.id,qa.choices,qa.correct_index FROM quiz_attempt_answers qa JOIN quiz_attempts a ON a.id=qa.attempt_id WHERE qa.attempt_id=$1 AND qa.source_question_id=$2 AND a.student_id=$3 AND a.status='in_progress'`,[attemptId,qid,s.id])).rows[0];
  if(!a) return res.status(404).json({ok:false});
  const choices=Array.isArray(a.choices)?a.choices:[]; const isCorrect=answer===a.correct_index;
  await pool.query(`UPDATE quiz_attempt_answers SET selected_index=$1,selected_answer=$2,is_correct=$3 WHERE id=$4`,[answer,choices[answer]||'No answer',isCorrect,a.id]);
  await pool.query(`INSERT INTO quiz_progress(student_id,question_id,is_correct,selected_answer,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,question_id) DO UPDATE SET is_correct=$3,selected_answer=$4,updated_at=now()`,[s.id,qid,isCorrect,answer]);
  const agg=(await pool.query(`SELECT count(*) FILTER (WHERE selected_index IS NOT NULL)::int answered,count(*) FILTER (WHERE is_correct=true)::int correct FROM quiz_attempt_answers WHERE attempt_id=$1`,[attemptId])).rows[0];
  const current=Number(agg.answered)?Math.round(Number(agg.correct)/Number(agg.answered)*100):null;
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=$2,total=$3,current_score=$4,updated_at=now()`,[s.id,Number(agg.answered),Math.max(0,Number(req.body.total)||0),current]);
  res.json({ok:true});
});

app.post('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const attemptId=Number(req.body.attempt_id); if(!attemptId) return res.status(400).send('Missing quiz attempt');
  const attempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[attemptId,s.id])).rows[0];
  if(!attempt) return res.status(400).send(layout('Quiz Already Submitted','<div class="card">This quiz attempt is no longer active.</div>'));
  const answers=await pool.query(`SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[attemptId]);
  let correct=0; const review=[]; const missed=[];
  for(const row of answers.rows){
    const field='q_'+row.source_question_id; const raw=req.body[field]; const selectedIndex=(raw===undefined||raw===null||raw==='')?row.selected_index:Number(raw);
    const choices=Array.isArray(row.choices)?row.choices:[]; const ok=Number.isInteger(selectedIndex) && selectedIndex===row.correct_index; if(ok) correct++;
    const selectedAnswer=Number.isInteger(selectedIndex)?(choices[selectedIndex]||'No answer'):'No answer';
    await pool.query(`UPDATE quiz_attempt_answers SET selected_index=$1,selected_answer=$2,is_correct=$3 WHERE id=$4`,[Number.isInteger(selectedIndex)?selectedIndex:null,selectedAnswer,ok,row.id]);
    const item={attempt_answer_id:row.id,question_id:row.source_question_id,question:row.question_text,topic:row.topic||'',choices,selected_index:Number.isInteger(selectedIndex)?selectedIndex:null,answer_index:row.correct_index,selected:selectedAnswer,correct:row.correct_answer,explanation:row.explanation||'Review this topic with your instructor.',is_correct:ok};
    review.push(item); if(!ok) missed.push(item);
  }
  const total=answers.rowCount, score=total?Math.round(correct/total*100):0; const details={attempt_id:attemptId,correct,total,missed,review};
  await pool.query(`UPDATE quiz_attempts SET score=$1,correct_count=$2,total_questions=$3,status='completed',completed_at=now() WHERE id=$4`,[score,correct,total,attemptId]);
  await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Module Quiz',$2,$3)",[s.id,score,JSON.stringify(details)]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Finished',$2,$2,$3,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Finished',progress=$2,total=$2,current_score=$3,updated_at=now()`,[s.id,total,score]);
  const reviewHtml=renderAttemptReview(review,score,true);
  const passed=score>=s.pass_score; if(passed) await ensureCertificate(s.id);
  const certHtml=passed?`<div class="card center" style="border:4px solid var(--red);background:#fffafa"><div class="eyebrow">Passed · Certificate Ready</div><div class="big" style="font-size:30px">Congratulations, ${esc(s.name)}</div><p>Your certificate of completion is ready now.</p><a class="btn" href="/student/${s.id}/certificate?token=${encodeURIComponent(s.join_token)}" target="_blank">View My Certificate</a></div>`:`<div class="card"><div class="alert"><b>Certificate not yet available.</b> Your score was ${score}%. The passing score is ${s.pass_score}%.</div></div>`;
  res.send(layout('Quiz Complete', `<div class="card center"><div class="eyebrow">Training Hub v5.6 · Attempt #${attemptId}</div><div class="big">Quiz Complete</div><div class="code">${score}%</div><p>${correct} of ${total} correct · ${missed.length} missed</p></div>${certHtml}${reviewHtml}<div class="card center"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/quiz-review', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const attempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[s.id])).rows[0];
  if(attempt){
    const rows=(await pool.query(`SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[attempt.id])).rows;
    const review=rows.map(attemptRowToReviewItem); const reviewHtml=renderAttemptReview(review,attempt.score,true);
    return res.send(layout('Quiz Review', `<div class="card"><div class="eyebrow">Permanent Quiz Attempt #${attempt.id} · v5.6</div><div class="big">Quiz Review — Latest Attempt</div><p>Completed ${new Date(attempt.completed_at).toLocaleString()}</p>${reviewHtml}<div class="toolbar"><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
  }
  const old=(await pool.query("SELECT score,details,completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC,id DESC LIMIT 1",[s.id])).rows[0];
  if(!old) return res.send(layout('Quiz Review', `<div class="card"><div class="big">No Quiz Result Yet</div><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a></div>`));
  const repaired=await repairQuizReviewData(s.id,old.details||{});
  const reviewHtml=repaired.review.length?renderAttemptReview(repaired.review,old.score,true):`<div class="alert"><b>This older attempt has no recoverable question snapshot.</b> New v5.6 attempts are stored permanently.</div>`;
  res.send(layout('Quiz Review', `<div class="card"><div class="eyebrow">Legacy Quiz Record · v5.6 Recovery</div><div class="big">Quiz Review</div>${reviewHtml}<div class="toolbar" style="margin-top:16px"><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
});

app.get('/student/:id/hunt', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[s.class_id]);
  const p=await pool.query('SELECT station_id,correct FROM hunt_progress WHERE student_id=$1',[s.id]); const completed=new Map(p.rows.map(x=>[x.station_id,x]));
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status='Hunt',progress=$2,total=$3,updated_at=now()`,[s.id,completed.size,q.rowCount]);
  const tractorCount=Math.min(5,Math.max(1,Number(s.hunt_tractor_count)||3));
  const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[s.class_id]); const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model]));
  for(const x of q.rows) if(x.tractor_no&&x.tractor_model&&!models.has(Number(x.tractor_no))) models.set(Number(x.tractor_no),x.tractor_model);
  const tractorName=n=>models.get(n)||`Tractor ${n}`;
  const groups=Array.from({length:tractorCount},(_,i)=>i+1).map(n=>{const rows=q.rows.filter(x=>Number(x.tractor_no)===n);const body=rows.map(x=>{const sn=q.rows.findIndex(y=>y.id===x.id)+1;return `<tr><td>${sn}</td><td><b>${esc(x.item_label||x.station_name)}</b></td><td>${completed.has(x.id)?'<span class="pill results">Complete</span>':'<span class="pill">Not Scanned</span>'}</td></tr>`}).join('');return `<div class="card"><div class="section-title"><div><div class="eyebrow">TRACTOR ${n}</div><div class="big">${esc(tractorName(n))}</div></div><span class="pill">${rows.length} Item${rows.length===1?'':'s'}</span></div><table><tr><th>#</th><th>Hunt Item</th><th>Status</th></tr>${body||'<tr><td colspan="3">No hunt items assigned.</td></tr>'}</table></div>`}).join('');
  res.send(layout('Scavenger Hunt', `<div class="card"><div class="eyebrow">Hands-On Individual Activity</div><div class="big">Tractor Technician Scavenger Hunt</div><div class="grid"><div class="stat"><span>Your Progress</span><b>${completed.size} / ${q.rowCount}</b></div><div class="stat"><span>How It Works</span><b style="font-size:18px">Scan · Find · Submit</b></div></div><div class="alert"><b>Work individually:</b> Scan each station QR code with your phone, locate or verify the requested item, then submit your answer or measurement. There are no teams or assigned team roles.</div></div>${groups}<div class="card"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function readCookies(req){ return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]})); }
app.get('/hunt-station/:cid/:sid', async(req,res)=>{
  const station=(await pool.query('SELECT h.*,c.course,c.code,c.join_token,c.active,c.hunt_tractor_count FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||!station.active) return res.status(404).send(layout('Station Unavailable','<div class="card">This scavenger-hunt station is not available.</div>'));
  const cookie=readCookies(req)[`mth_student_${station.class_id}`]||''; const [studentId,token]=cookie.split(':'); let student=null; if(studentId&&token===station.join_token) student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[studentId,station.class_id])).rows[0];
  if(!student) return res.send(layout('Identify Technician', `<div class="card"><span class="pill">Class ${esc(station.code)}</span><div class="big">${esc(station.station_name)}</div><p>Join the class first, then scan this station QR again.</p><a class="btn" href="/c/${esc(station.join_token)}">Join Class</a></div>`));
  const done=(await pool.query('SELECT * FROM hunt_progress WHERE student_id=$1 AND station_id=$2',[student.id,station.id])).rows[0];
  const stationOrder=(await pool.query('SELECT id FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[station.class_id])).rows; const stationNumber=Math.max(1,stationOrder.findIndex(x=>Number(x.id)===Number(station.id))+1);
  res.send(layout(station.station_name, `<div class="card"><span class="pill hunt">Station ${stationNumber}</span><div class="big" style="margin-top:12px">${esc(station.item_label||station.station_name)}</div><p class="muted">${esc(station.tractor_model||'')} ${station.tractor_no?`· Tractor ${station.tractor_no}`:''}</p><h3>Your Task</h3><p>${esc(station.task)}</p>${done?`<div class="success">Completed. Your answer: <b>${esc(done.answer)}</b></div><a class="btn light" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a>`:`<form method="post" action="/hunt-station/${station.class_id}/${station.id}"><input type="hidden" name="student_id" value="${student.id}"><input type="hidden" name="token" value="${esc(station.join_token)}"><label>Your Answer / Measurement<input name="answer" required autofocus></label><button>Submit Station</button></form>`}</div>`));
});
app.post('/hunt-station/:cid/:sid', async(req,res)=>{
  const station=(await pool.query('SELECT h.*,c.join_token FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||req.body.token!==station.join_token) return res.status(403).send('Invalid station');
  const student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[req.body.student_id,station.class_id])).rows[0]; if(!student) return res.status(403).send('Student not found');
  const answer=(req.body.answer||'').trim(); const a=answer.toLowerCase(), e=station.expected.toLowerCase(); const correct=!!a&&(a.includes(e)||e.includes(a));
  await pool.query(`INSERT INTO hunt_progress(student_id,station_id,answer,correct,completed_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,station_id) DO UPDATE SET answer=$3,correct=$4,completed_at=now()`,[student.id,station.id,answer,correct]);
  const total=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1',[station.class_id])).rows[0].n); const p=(await pool.query('SELECT count(*)::int done,count(*) FILTER (WHERE correct)::int correct FROM hunt_progress hp JOIN hunt_stations h ON h.id=hp.station_id WHERE hp.student_id=$1 AND h.class_id=$2',[student.id,station.class_id])).rows[0];
  const score=total?Math.round(Number(p.correct)/total*100):0; await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status=$5,progress=$2,total=$3,current_score=$4,updated_at=now()`,[student.id,Number(p.done),total,score,Number(p.done)>=total?'Finished':'Hunt']);
  if(Number(p.done)>=total){ await pool.query("DELETE FROM results WHERE student_id=$1 AND activity='Scavenger Hunt'",[student.id]); await pool.query(`INSERT INTO results(student_id,activity,score,details) VALUES($1,'Scavenger Hunt',$2,$3)`,[student.id,score,JSON.stringify({completed:Number(p.done),total})]); }
  res.send(layout('Station Complete', `<div class="card center"><div class="big">Station Complete</div><p>${esc(station.station_name)}</p><div class="success">Answer recorded.</div><p>${p.done} of ${total} stations complete.</p><a class="btn" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a></div>`));
});

app.get('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const assignments=(await pool.query(`SELECT * FROM simulation_assignments WHERE class_id=$1 AND enabled=true ORDER BY configured_at DESC`,[s.class_id])).rows;
  const attempts=(await pool.query(`SELECT * FROM simulation_attempts WHERE student_id=$1 ORDER BY COALESCE(completed_at,started_at) DESC,id DESC`,[s.id])).rows;
  const latestBySim=new Map(); for(const a of attempts){ if(!latestBySim.has(a.simulation_key)) latestBySim.set(a.simulation_key,a); }
  const cards=assignments.map(a=>{
    const sim=simByKey(a.simulation_key); if(!sim) return '';
    const tractorModel=a.tractor_model||tractorChoicesForSim(sim)[0];
    const displayTitle=simulationDisplayTitle(sim,tractorModel);
    const prev=latestBySim.get(sim.key);
    const status=prev?.status==='completed'?`<div class="success"><b>Latest Score:</b> ${prev.score}%</div>`:prev?.status==='in_progress'?`<div class="alert"><b>In Progress</b> · Attempt #${prev.id}</div>`:'<div class="muted">Not attempted yet.</div>';
    const action=prev?.status==='in_progress'?`<a class="btn" href="/student/${s.id}/scenario/${prev.id}?token=${encodeURIComponent(s.join_token)}">Continue Simulation</a>`:`<form method="post" action="/student/${s.id}/scenario/start?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="simulation_key" value="${esc(sim.key)}"><button>${prev?.status==='completed'?'Run Again':'Start Simulation'}</button></form>`;
    const review=prev?.status==='completed'?`<a class="btn light" href="/student/${s.id}/scenario/${prev.id}/review?token=${encodeURIComponent(s.join_token)}">Review Latest Attempt</a>`:'';
    return `<div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><div><div class="eyebrow">${esc(sim.level)} DIAGNOSTIC SIMULATION</div><div class="big">${esc(displayTitle)}</div></div><span class="sim-badge">${esc(sim.workOrder)}</span></div><p><b>Tractor:</b> ${esc(tractorModel)} &nbsp; · &nbsp; <b>Hours:</b> ${esc(sim.hours)}</p><div class="alert"><b>Customer Complaint:</b><br>${esc(sim.complaint)}</div>${status}<div class="toolbar" style="margin-top:12px">${action}${review}</div></div>`;
  }).join('');
  const history=attempts.slice(0,20).map(a=>`<tr><td>${esc(a.title)}</td><td>${a.status==='completed'?a.score+'%':'In Progress'}</td><td>${new Date(a.completed_at||a.started_at).toLocaleString()}</td><td>${a.status==='completed'?`<a class="btn light" href="/student/${s.id}/scenario/${a.id}/review?token=${encodeURIComponent(s.join_token)}">Review</a>`:`<a class="btn light" href="/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}">Continue</a>`}</td></tr>`).join('');
  res.send(layout('Diagnostic Simulation Library', `<div class="toolbar"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">← Back to Training</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#4b090d);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">Diagnostic Failure Simulation System · v5.6</div><div class="big" style="font-size:30px">Simulation Library</div><p style="margin-bottom:0">Your instructor chooses the hidden planted failure. Your job is to prove it.</p></div>${cards||'<div class="card"><div class="big">Waiting for Instructor</div><p>No diagnostic simulations have been released for this class yet.</p></div>'}<div class="card"><div class="big">My Simulation History</div><div style="overflow:auto"><table><thead><tr><th>Simulation</th><th>Score</th><th>Date</th><th></th></tr></thead><tbody>${history||'<tr><td colspan="4">No simulation attempts yet.</td></tr>'}</tbody></table></div></div>`,simulationCss()));
});

app.post('/student/:id/scenario/start', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const simulationKey=(req.body.simulation_key||'').trim(), base=simByKey(simulationKey); if(!base) return res.status(400).send('Unknown simulation.');
  const existing=(await pool.query(`SELECT * FROM simulation_attempts WHERE student_id=$1 AND simulation_key=$2 AND status='in_progress' ORDER BY started_at DESC LIMIT 1`,[s.id,simulationKey])).rows[0];
  if(existing) return res.redirect(`/student/${s.id}/scenario/${existing.id}?token=${encodeURIComponent(s.join_token)}`);
  const assignment=await getSimulationAssignment(s.class_id,simulationKey);
  if(!assignment) return res.status(400).send('Instructor has not released this simulation for your class.');
  const sim=simForRoot(simulationKey,assignment.root_cause_key); if(!sim) return res.status(400).send('Simulation root cause is not configured correctly.');
  const tractorModel=assignment.tractor_model||tractorChoicesForSim(sim)[0];
  if(!validTractorForSim(sim,tractorModel)) return res.status(400).send('Instructor tractor selection is not valid for this simulation.');
  const a=(await pool.query(`INSERT INTO simulation_attempts(student_id,class_id,simulation_key,title,work_order,root_cause_key,assigned_diagnosis,assigned_repair,tractor_model,status,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'in_progress',now()) RETURNING *`,[s.id,s.class_id,sim.key,simulationDisplayTitle(sim,tractorModel),sim.workOrder,sim.rootCauseKey,sim.correctDiagnosis,sim.correctRepair,tractorModel])).rows[0];
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Failure Simulation','Diagnosing',0,7,0,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Failure Simulation',status='Diagnosing',progress=0,total=7,current_score=0,updated_at=now()`,[s.id]);
  res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}`);
});

app.get('/student/:id/scenario/:attemptId', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a) return res.status(404).send('Simulation attempt not found');
  if(a.status==='completed') return res.redirect(`/student/${s.id}/scenario/${a.id}/review?token=${encodeURIComponent(s.join_token)}`);
  const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key); const actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
  const doneRows=new Map(actions.map(x=>[x.action_key,x])); const totals=await recalcSimulation(a.id); const evidence=actions.length?actions.map((x,i)=>`<div class="sim-log ${x.penalty?'penalty':x.points?'good':''}"><b>${i+1}. ${esc(x.label)}</b> ${x.points?`<span class="sim-badge">+${x.points}</span>`:''}${x.penalty?`<span class="sim-badge">-${x.penalty}</span>`:''}<div style="margin-top:6px">${esc(x.result_text)}</div></div>`).join(''):'<p class="muted">No diagnostic evidence collected yet. Choose a tool or test.</p>';
  const cats=['Visual Inspection','Fault Codes','Live Data','Wiring Diagram','Multimeter','Pressure Tests','Component Tests','Service Information','Repair History','Replace Part'];
  const tools=cats.map(cat=>{const list=sim.actions.filter(x=>x.category===cat); if(!list.length)return ''; return `<div class="sim-tool"><h3>${esc(cat)}</h3>${list.map(x=>{const row=doneRows.get(x.key);if(row){const supportedReplacement=x.category==='Replace Part' && sim.rootCause?.replacementAction===x.key && Number(row.penalty||0)===0;const cls=Number(row.penalty||0)>0?'sim-choice-wrong':(Number(row.points||0)>0||supportedReplacement)?'sim-choice-good':'sim-choice-neutral';const icon=cls==='sim-choice-good'?'✓':cls==='sim-choice-wrong'?'✕':'•';return `<button type="button" class="${cls}" disabled>${icon} ${esc(x.label)}</button>`;}return `<form method="post" action="/student/${s.id}/scenario/${a.id}/action?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="action_key" value="${esc(x.key)}"><button class="${x.penalty?'alt':''}">${esc(x.label)}</button></form>`;}).join('')}</div>`}).join('');
  const finalForm=`<div class="card sim-final"><div class="big">Final Diagnosis</div><p>When you believe you have enough evidence, choose the root cause and repair. You can continue testing before submitting.</p><form method="post" action="/student/${s.id}/scenario/${a.id}/final?token=${encodeURIComponent(s.join_token)}"><label>Root Cause<select name="diagnosis" required><option value="">Choose the most likely root cause</option>${sim.rootCauses.map(x=>`<option>${esc(x.diagnosis)}</option>`).join('')}</select></label><label>Repair / Verification<select name="repair" required><option value="">Choose the repair and verification</option>${sim.rootCauses.map(x=>`<option>${esc(x.repair)}</option>`).join('')}</select></label><button>Submit Final Diagnosis</button></form></div>`;
  res.send(layout('Virtual Diagnostic Bay', `<div class="sim-shell"><aside class="sim-wo"><div class="eyebrow" style="color:#ffb9bd">VIRTUAL SHOP BAY</div><h2>${esc(a.tractor_model||sim.model)}</h2><div class="sim-meta"><div><span>Work Order</span><b>${esc(sim.workOrder)}</b></div><div><span>Hour Meter</span><b>${esc(sim.hours)} h</b></div><div><span>Status</span><b>Diagnosing</b></div><div><span>Elapsed</span><b id="simTimer" class="sim-timer">${elapsedText(a.started_at)}</b></div></div><div class="alert"><b>Complaint</b><br>${esc(sim.complaint)}</div><p><b>Assignment:</b><br>${esc(sim.assignment)}</p><hr style="border-color:#444"><div>Current Score</div><div class="sim-score">${totals.score}%</div><div>Earned: ${totals.positive} · Penalties: -${totals.penalty}</div>${totals.penalty?`<div class="parts-penalty" style="margin-top:10px">Parts Cannon Penalty: -${totals.penalty}</div>`:''}</aside><main><div class="card"><div class="section-title"><div><div class="eyebrow">Choose Your Diagnostic Path</div><div class="big">Diagnostic Tools & Information</div><div class="sim-path-key"><span class="g"><i></i>Correct diagnostic path</span><span class="r"><i></i>Wrong / premature choice</span><span class="n"><i></i>Information collected</span></div></div><span class="sim-badge">Attempt #${a.id}</span></div><div class="sim-tools" style="margin-top:15px">${tools}</div></div><div class="card"><div class="big">Evidence Log</div>${evidence}</div>${finalForm}</main></div>`, `${simulationCss()}<script>const st=new Date(${JSON.stringify(new Date(a.started_at).toISOString())}).getTime();setInterval(()=>{const x=Math.max(0,Math.floor((Date.now()-st)/1000)),m=Math.floor(x/60),ss=String(x%60).padStart(2,'0');const e=document.getElementById('simTimer');if(e)e.textContent=m+':'+ss;},1000);</script>`));
});

app.post('/student/:id/scenario/:attemptId/action', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a||a.status!=='in_progress') return res.status(400).send('Simulation is not active');
  const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), action=sim.actions.find(x=>x.key===req.body.action_key); if(!action) return res.status(400).send('Unknown diagnostic action');
  const seq=Number((await pool.query('SELECT COALESCE(max(sequence),0)::int n FROM simulation_actions WHERE attempt_id=$1',[a.id])).rows[0].n)+1;
  let actionPenalty=action.penalty||0, actionResult=action.result;
  if(action.category==='Replace Part'){
    const root=sim.rootCause||rootCauseByKey(sim,a.root_cause_key);
    if(root?.replacementAction===action.key){
      const proofRows=(await pool.query(`SELECT action_key FROM simulation_actions WHERE attempt_id=$1`,[a.id])).rows.map(x=>x.action_key);
      const required=Array.isArray(root.proof)?root.proof:[];
      const proven=required.length>0 && required.every(k=>proofRows.includes(k));
      if(proven){ actionPenalty=0; actionResult='Replacement is supported by the diagnostic evidence already collected. Continue to final repair verification.'; }
      else { actionPenalty=15; actionResult='PARTS CANNON PENALTY: this is the planted failed component, but it was replaced before the required proof-of-failure tests were completed.'; }
    }
  }
  await pool.query(`INSERT INTO simulation_actions(attempt_id,action_key,category,label,result_text,points,penalty,sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(attempt_id,action_key) DO NOTHING`,[a.id,action.key,action.category,action.label,actionResult,action.points||0,actionPenalty,seq]);
  const totals=await recalcSimulation(a.id); const progress=Math.min(5,(await pool.query(`SELECT count(*)::int n FROM simulation_actions WHERE attempt_id=$1 AND points>0`,[a.id])).rows[0].n);
  await pool.query(`UPDATE activity_status SET activity='Failure Simulation',status='Diagnosing',progress=$1,total=7,current_score=$2,updated_at=now() WHERE student_id=$3`,[Number(progress),totals.score,s.id]);
  res.redirect(`/student/${s.id}/scenario/${a.id}?token=${encodeURIComponent(s.join_token)}`);
});

app.post('/student/:id/scenario/:attemptId/final', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a||a.status!=='in_progress') return res.status(400).send('Simulation is not active');
  const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key); const diagnosis=(req.body.diagnosis||'').trim(), repair=(req.body.repair||'').trim();
  const correctDiagnosis=a.assigned_diagnosis||sim.correctDiagnosis, correctRepair=a.assigned_repair||sim.correctRepair; const diagnosisCorrect=diagnosis===correctDiagnosis, repairCorrect=diagnosisCorrect && repair===correctRepair;
  await pool.query(`UPDATE simulation_attempts SET final_diagnosis=$1,final_repair=$2,diagnosis_correct=$3,repair_correct=$4 WHERE id=$5`,[diagnosis,repair,diagnosisCorrect,repairCorrect,a.id]);
  const totals=await recalcSimulation(a.id);
  await pool.query(`UPDATE simulation_attempts SET status='completed',completed_at=now() WHERE id=$1`,[a.id]);
  const actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
  const details={attempt_id:a.id,simulation_key:a.simulation_key,tractor_model:a.tractor_model||sim.model,work_order:sim.workOrder,diagnosis,repair,diagnosis_correct:diagnosisCorrect,repair_correct:repairCorrect,positive_points:totals.positive,penalty_points:totals.penalty,actions:actions.map(x=>({action:x.label,result:x.result_text,points:x.points,penalty:x.penalty}))};
  await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Failure Simulation',$2,$3)",[s.id,totals.score,JSON.stringify(details)]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Failure Simulation','Finished',7,7,$2,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Failure Simulation',status='Finished',progress=7,total=7,current_score=$2,updated_at=now()`,[s.id,totals.score]);
  res.redirect(`/student/${s.id}/scenario/${a.id}/review?token=${encodeURIComponent(s.join_token)}`);
});

app.get('/student/:id/scenario/:attemptId/review', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const a=await getSimAttemptForStudent(s.id,Number(req.params.attemptId)); if(!a) return res.status(404).send('Simulation attempt not found');
  const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
  const rows=actions.map((x,i)=>`<div class="sim-log ${x.penalty?'penalty':x.points?'good':''}"><b>${i+1}. ${esc(x.label)}</b>${x.points?` · +${x.points}`:''}${x.penalty?` · -${x.penalty}`:''}<div>${esc(x.result_text)}</div></div>`).join('');
  const elapsed=a.completed_at?Math.max(0,Math.floor((new Date(a.completed_at)-new Date(a.started_at))/1000)):0, elapsedFmt=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
  res.send(layout('Simulation Review', `<div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">Permanent Diagnostic Simulation Attempt #${a.id}</div><div class="big">${esc(a.title||sim.title)}</div><p><b>Tractor:</b> ${esc(a.tractor_model||sim.model)}</p><div class="grid" style="margin-top:12px"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>PROCESS POINTS</span><b>${a.positive_points}</b></div><div class="stat"><span>PENALTIES</span><b>-${a.penalty_points}</b></div><div class="stat"><span>TIME</span><b>${elapsedFmt}</b></div></div></div><div class="card"><div class="big">Final Diagnosis</div><p><b>Technician Diagnosis:</b> ${esc(a.final_diagnosis||'Not submitted')} ${a.diagnosis_correct?'<span class="pill open">CORRECT</span>':'<span class="pill">INCORRECT</span>'}</p><p><b>Correct Diagnosis:</b> ${esc(a.assigned_diagnosis||sim.correctDiagnosis)}</p><p><b>Technician Repair:</b> ${esc(a.final_repair||'Not submitted')}</p><p><b>Correct Repair:</b> ${esc(a.assigned_repair||sim.correctRepair)}</p></div><div class="card"><div class="big">Diagnostic Process Review</div>${rows||'<p>No diagnostic actions recorded.</p>'}</div><div class="card"><div class="big">Scoring Breakdown</div><table><tr><th>Area</th><th>Points</th></tr><tr><td>Verify customer complaint</td><td>10</td></tr><tr><td>Check fault codes</td><td>10</td></tr><tr><td>Review live data</td><td>15</td></tr><tr><td>Select correct circuit test</td><td>20</td></tr><tr><td>Use multimeter correctly</td><td>15</td></tr><tr><td>Identify root cause</td><td>20</td></tr><tr><td>Verify repair</td><td>10</td></tr><tr><th>Total Possible</th><th>100</th></tr></table>${a.penalty_points?`<div class="parts-penalty" style="margin-top:12px">Parts Cannon Penalty Applied: -${a.penalty_points} points</div>`:''}</div><div class="toolbar"><a class="btn" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Run Simulation Again</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`,simulationCss()));
});

app.get('/student/:id/feedback', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  if((await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount) return res.send(layout('Feedback Complete',`<div class="card center"><div class="big">Thank You</div><p>Your training feedback has already been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
  const rating=(name,label)=>`<label>${label}<div class="rating">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${name}" value="${n}" required>${n}</label>`).join('')}</div><span class="small muted">1 = Low · 5 = Excellent</span></label>`;
  res.send(layout('Training Feedback', `<div class="card"><div class="big">Training Feedback</div><p>Your feedback helps improve future technician training.</p><form method="post" action="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">${rating('overall','Overall Training')}${rating('instructor','Instructor Effectiveness')}${rating('usefulness','Usefulness of the Material')}${rating('hands_on','Hands-On Activities')}${rating('difficulty','Difficulty Level / Pace')}<label>What was most helpful?<textarea name="most_helpful" rows="3"></textarea></label><label>What should be improved?<textarea name="improve" rows="3"></textarea></label><label>Other Comments<textarea name="comments" rows="3"></textarea></label><button>Submit Feedback</button></form></div>`));
});
app.post('/student/:id/feedback', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const nums=['overall','instructor','usefulness','hands_on','difficulty'].map(k=>Math.min(5,Math.max(1,Number(req.body[k])||1)));
  await pool.query(`INSERT INTO training_feedback(student_id,overall,instructor,usefulness,hands_on,difficulty,most_helpful,improve,comments,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT(student_id) DO UPDATE SET overall=$2,instructor=$3,usefulness=$4,hands_on=$5,difficulty=$6,most_helpful=$7,improve=$8,comments=$9,submitted_at=now()`,[s.id,...nums,req.body.most_helpful||'',req.body.improve||'',req.body.comments||'']);
  res.send(layout('Thank You', `<div class="card center"><div class="big">Thank You</div><p>Your feedback has been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function pinForm(message=''){ return layout('Instructor Login', `<div class="card" style="max-width:500px;margin:auto"><div class="big">Instructor Access</div>${message?`<div class="alert">${esc(message)}</div>`:''}<form method="post" action="/instructor/login"><label>Instructor PIN<input type="password" name="pin" inputmode="numeric" required autofocus></label><button>Open Dashboard</button></form></div>`); }
app.get('/instructor',(req,res)=>res.send(pinForm()));
app.post('/instructor/login',(req,res)=>{ if(req.body.pin!==INSTRUCTOR_PIN) return res.send(pinForm('Incorrect PIN.')); res.redirect('/instructor/dashboard?pin='+encodeURIComponent(INSTRUCTOR_PIN)); });
function auth(req,res,next){ if((req.query.pin||req.body.pin)!==INSTRUCTOR_PIN) return res.status(403).send(pinForm('Instructor login required.')); next(); }

app.get('/instructor/dashboard',auth,async(req,res)=>{
  const classes=await pool.query(`SELECT c.*,count(distinct s.id)::int students,count(r.id)::int results FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN results r ON r.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 30`);
  const settingsQ=await pool.query('SELECT key,value FROM site_settings'); const settings=Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]));
  const rows=classes.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td><span class="pill">${esc(c.code)}</span></td><td><b>${c.students}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'LIVE':'Closed'}</span></td><td class="nowrap"><a class="btn" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Live Class</a></td></tr>`).join('');
  const active=classes.rows.filter(c=>c.active).length; const students=classes.rows.reduce((a,c)=>a+c.students,0);
  const certCount=Number((await pool.query('SELECT count(*)::int n FROM instructor_notes WHERE certificate_no IS NOT NULL')).rows[0].n||0);
  res.send(layout('Instructor Dashboard', `<div style="background:linear-gradient(135deg,#171717,#5a0b10);color:#fff;border-radius:22px;padding:28px;border-bottom:7px solid var(--red);box-shadow:0 8px 24px rgba(0,0,0,.12)"><div class="eyebrow" style="color:#ffb9bd">MAHINDRA TECHNICIAN TRAINING HUB · VERSION 5.6</div><h1 style="margin:7px 0 4px;font-size:36px">Instructor Command Center</h1><p style="margin:0;color:#eee">${esc(settings.home_message||'Start classes, build activities, watch technicians, and print training records.')}</p><div class="toolbar" style="margin-top:18px"><a class="btn" href="/instructor/new?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">+ Start New Class</a><a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Student Records</a></div></div><div class="grid" style="margin-top:18px"><div class="stat"><span>LIVE CLASSES</span><b>${active}</b></div><div class="stat"><span>TECHNICIANS</span><b>${students}</b></div><div class="stat"><span>CERTIFICATES ISSUED</span><b>${certCount}</b></div><div class="stat green"><span>SYSTEM</span><b>ONLINE</b></div></div><div class="home-grid"><a class="home-card" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">📝</div><div class="title">Tests</div><div class="desc">Build and manage quiz questions.</div></a><a class="home-card" href="/instructor/hunt-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🔎</div><div class="title">Scavenger Hunt</div><div class="desc">Choose tractors, models, hunt items, and print QR stations.</div></a><a class="home-card" href="/instructor/simulations?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🛠️</div><div class="title">Simulation Library</div><div class="desc">Release diagnostic scenarios, choose hidden root causes, and review technician diagnostic paths.</div></a><a class="home-card" href="/instructor/reports?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🏆</div><div class="title">Reports & Certificates</div><div class="desc">Print records and certificates for completed technicians.</div></a><a class="home-card" href="/instructor/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">★</div><div class="title">Training Feedback</div><div class="desc">Review technician ratings and comments.</div></a><a class="home-card" href="/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">⚙️</div><div class="title">Admin & Content</div><div class="desc">Courses, wording, content, and training-system settings.</div></a></div><div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><h2>Live & Recent Classes</h2><span class="pill open">v5.6 ACTIVE</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Class</th><th>Code</th><th>Students</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No classes yet. Click Start New Class above.</td></tr>'}</tbody></table></div></div>`));
});

app.get('/instructor/simulations',auth,async(req,res)=>{
  const q=await pool.query(`SELECT a.*,s.name,s.dealer,c.course,c.code FROM simulation_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id ORDER BY COALESCE(a.completed_at,a.started_at) DESC,a.id DESC LIMIT 200`);
  const rows=q.rows.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.dealer)}</td><td>${esc(a.title)}</td><td>${a.status==='completed'?a.score+'%':'In Progress'}</td><td>${a.penalty_points?'-'+a.penalty_points:'0'}</td><td>${a.completed_at?new Date(a.completed_at).toLocaleString():new Date(a.started_at).toLocaleString()}</td><td><a class="btn light" href="/instructor/simulation/${a.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open</a></td></tr>`).join('');
  const classes=(await pool.query(`SELECT c.*, (SELECT count(*)::int FROM students s WHERE s.class_id=c.id) student_count FROM classes c ORDER BY c.active DESC,c.created_at DESC LIMIT 100`)).rows;
  const assignments=(await pool.query(`SELECT * FROM simulation_assignments WHERE enabled=true ORDER BY configured_at DESC`)).rows;
  const latestBySim=new Map();
  for(const a of assignments){ if(!latestBySim.has(a.simulation_key)) latestBySim.set(a.simulation_key,a); }
  const classOptions=classes.map(c=>`<option value="${c.id}">${esc(c.code)} · ${c.student_count} technician(s) · ${c.active?'Active':'Closed'}</option>`).join('');
  const sims=Object.values(DIAGNOSTIC_SIMULATIONS).map(sim=>{
    const a=latestBySim.get(sim.key)||null;
    const selectedClass=a?.class_id||'';
    const selectedRoot=a?.root_cause_key||'';
    const selectedTractor=(a?.tractor_model||'').replace('3100 HST','3100');
    const tractors=tractorChoicesForSim(sim);
    const selectedClassRow=classes.find(c=>Number(c.id)===Number(selectedClass));
    return `<div class="card" style="border-top:5px solid var(--red)">
      <div class="section-title"><div><div class="eyebrow">DIAGNOSTIC SIMULATION</div><div class="big">${esc(sim.title)}</div></div>${selectedClass&&selectedRoot&&selectedTractor?'<span class="pill open">RELEASED</span>':'<span class="pill">NOT RELEASED</span>'}</div>
      <p><b>Work Order:</b> ${esc(sim.workOrder)}</p>
      <div class="alert"><b>Customer Complaint:</b> ${esc(sim.complaint)}</div>
      <form method="post" action="/instructor/simulations/${encodeURIComponent(sim.key)}/configure?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" style="margin-top:14px">
        <label>Class<select name="class_id" class="sim-class-select" required><option value="" data-count="0">Choose class</option>${classes.map(c=>`<option value="${c.id}" data-count="${Math.max(0,Number(c.student_count)||0)}" ${Number(selectedClass)===Number(c.id)?'selected':''}>${esc(c.code)} · ${c.student_count} technician(s) · ${c.active?'Active':'Closed'}</option>`).join('')}</select></label>
        <label>Tractor / Model<select name="tractor_model" required><option value="">Choose one tractor / model</option>${tractors.map(m=>`<option value="${esc(m)}" ${selectedTractor===m?'selected':''}>${esc(m)}</option>`).join('')}</select></label>
        <label>Planted Root Cause<select name="root_cause_key" required><option value="">Select the failure BEFORE students begin</option>${sim.rootCauses.map(r=>`<option value="${esc(r.key)}" ${selectedRoot===r.key?'selected':''}>${esc(r.diagnosis)}</option>`).join('')}</select></label>
        <button>${selectedClass&&selectedRoot&&selectedTractor?'Update Simulation':'Release This Simulation'}</button>
      </form>
      ${selectedClass&&selectedRoot&&selectedTractor?`<div class="success" style="margin-top:10px"><b>Instructor Only:</b> Class ${esc(selectedClassRow?.code||selectedClass)} · Tractor: ${esc(selectedTractor)} · All enrolled technicians · Root Cause: ${esc(rootCauseByKey(sim,selectedRoot)?.diagnosis||'')}</div>`:''}
      <div class="toolbar"><a class="btn light" href="/instructor/simulations/${encodeURIComponent(sim.key)}/preview?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Preview Simulation & Root Causes</a></div>
    </div>`;
  }).join('');
  res.send(layout('Diagnostic Simulations', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Command Center</a></div><div class="card" style="background:linear-gradient(135deg,#171717,#4b090d);color:#fff;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#ffb9bd">Diagnostic Failure Simulation System · v5.6</div><div class="big" style="font-size:30px">Simulation Library</div><p style="margin-bottom:0">Choose the class, one tractor/model, and one hidden planted root cause. Releasing the simulation makes it available to every technician enrolled in that class.</p></div>${sims}<div class="card"><div class="big">Technician Attempts</div><p>Permanent record of each technician's diagnostic path, test sequence, parts-cannon penalties, final diagnosis, repair selection, score, and elapsed time.</p><div style="overflow:auto"><table class="sim-history"><thead><tr><th>Technician</th><th>Dealer</th><th>Simulation</th><th>Score</th><th>Penalty</th><th>Date</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7">No technician has run a simulation yet.</td></tr>'}</tbody></table></div></div>`,simulationCss()));
});

app.post('/instructor/simulations/:key/configure',auth,async(req,res)=>{
  const sim=DIAGNOSTIC_SIMULATIONS[req.params.key]; if(!sim) return res.status(404).send('Simulation not found');
  const classId=Number(req.body.class_id), rootKey=(req.body.root_cause_key||'').trim(), tractorModel=(req.body.tractor_model||'').trim(); if(!classId||!rootCauseByKey(sim,rootKey)||!validTractorForSim(sim,tractorModel)) return res.status(400).send('Choose a valid class, tractor, and root cause.');
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[classId])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const enrolled=Number((await pool.query('SELECT count(*)::int n FROM students WHERE class_id=$1',[classId])).rows[0].n||0);
  if(enrolled<1) return res.status(400).send('This class has no technicians enrolled yet. Add technicians before releasing a simulation.');
  const activeAttempts=Number((await pool.query(`SELECT count(*)::int n FROM simulation_attempts WHERE class_id=$1 AND simulation_key=$2 AND status='in_progress'`,[classId,sim.key])).rows[0].n);
  if(activeAttempts) return res.send(layout('Root Cause Locked', `<div class="card"><div class="big">Cannot Change Root Cause Yet</div><div class="alert">${activeAttempts} technician simulation attempt(s) are currently in progress for this class. Finish those attempts before changing the planted failure.</div><a class="btn" href="/instructor/simulations?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Simulations</a></div>`));
  await pool.query(`INSERT INTO simulation_assignments(class_id,simulation_key,root_cause_key,tractor_model,technician_limit,enabled,configured_at) VALUES($1,$2,$3,$4,15,true,now()) ON CONFLICT(class_id,simulation_key) DO UPDATE SET root_cause_key=$3,tractor_model=$4,technician_limit=15,enabled=true,configured_at=now()`,[classId,sim.key,rootKey,tractorModel]);
  res.redirect(`/instructor/simulations?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.get('/instructor/simulations/:key/preview',auth,async(req,res)=>{
  const sim=DIAGNOSTIC_SIMULATIONS[req.params.key];
  if(!sim) return res.status(404).send('Simulation not found');
  const grouped={}; for(const a of sim.actions){(grouped[a.category]||(grouped[a.category]=[])).push(a)}
  const tools=Object.entries(grouped).map(([cat,items])=>`<div class="card"><div class="big">${esc(cat)}</div>${items.map(a=>`<div class="sim-log ${a.penalty?'penalty':a.points?'good':''}"><b>${esc(a.label)}</b>${a.points?` <span class="sim-badge">+${a.points}</span>`:''}${a.penalty?` <span class="sim-badge">-${a.penalty}</span>`:''}<div style="margin-top:6px">${esc(a.result)}</div></div>`).join('')}</div>`).join('');
  res.send(layout('Instructor Simulation Preview', `<div class="toolbar"><a class="btn light" href="/instructor/simulations?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Simulation Library</a></div><div class="card" style="border-top:6px solid var(--red)"><div class="eyebrow">INSTRUCTOR PREVIEW · NOT A STUDENT ATTEMPT</div><div class="big" style="font-size:28px">${esc(sim.title)}</div><p><b>Tractor:</b> Selected by instructor when released<br>${esc(sim.workOrder)} · ${esc(sim.hours)} hours</p><div class="alert"><b>Customer Complaint:</b> ${esc(sim.complaint)}</div><p><b>Assignment:</b> ${esc(sim.assignment)}</p><div class="alert"><b>Instructor Root-Cause Choices:</b>${sim.rootCauses.map(r=>`<div style="margin-top:8px"><b>${esc(r.diagnosis)}</b><br><span class="muted">${esc(r.repair)}</span></div>`).join('')}</div></div><div class="card"><div class="big">Scoring</div><table><tr><th>Area</th><th>Points</th></tr><tr><td>Verify customer complaint</td><td>10</td></tr><tr><td>Check fault codes</td><td>10</td></tr><tr><td>Review live data</td><td>15</td></tr><tr><td>Correct circuit testing</td><td>20</td></tr><tr><td>Proper multimeter testing</td><td>15</td></tr><tr><td>Correct root cause</td><td>20</td></tr><tr><td>Correct repair / verification</td><td>10</td></tr><tr><th>Total</th><th>100</th></tr></table><div class="parts-penalty" style="margin-top:12px">Unproven component replacement: -15 points each</div></div>${tools}`,simulationCss()));
});
app.get('/instructor/simulation/:attemptId',auth,async(req,res)=>{
  const q=await pool.query(`SELECT a.*,s.name,s.dealer,s.id student_id,c.course,c.code FROM simulation_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1`,[req.params.attemptId]); const a=q.rows[0]; if(!a) return res.status(404).send('Simulation attempt not found');
  const sim=simForRoot(a.simulation_key,a.root_cause_key)||simByKey(a.simulation_key), actions=(await pool.query('SELECT * FROM simulation_actions WHERE attempt_id=$1 ORDER BY sequence',[a.id])).rows;
  const rows=actions.map((x,i)=>`<div class="sim-log ${x.penalty?'penalty':x.points?'good':''}"><b>${i+1}. ${esc(x.category)} — ${esc(x.label)}</b>${x.points?` · +${x.points}`:''}${x.penalty?` · -${x.penalty}`:''}<div>${esc(x.result_text)}</div></div>`).join('');
  res.send(layout('Simulation Attempt', `<div class="toolbar"><a class="btn light" href="/instructor/simulations?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Simulations</a><a class="btn light" href="/instructor/student/${a.student_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Student Record</a></div><div class="card"><div class="eyebrow">Permanent Simulation Attempt #${a.id}</div><div class="big">${esc(a.name)} · ${esc(a.title||sim.title)}</div><p>${esc(a.dealer)} · ${esc(a.tractor_model||sim.model)} · Class ${esc(a.code)}</p><div class="grid"><div class="stat"><span>SCORE</span><b>${a.score}%</b></div><div class="stat"><span>EARNED</span><b>${a.positive_points}</b></div><div class="stat"><span>PENALTY</span><b>-${a.penalty_points}</b></div><div class="stat"><span>STATUS</span><b>${esc(a.status)}</b></div></div></div><div class="card"><div class="big">Final Decision</div><p><b>Diagnosis:</b> ${esc(a.final_diagnosis||'Not submitted')} ${a.diagnosis_correct?'✓':'✗'}</p><p><b>Correct Diagnosis:</b> ${esc(a.assigned_diagnosis||sim.correctDiagnosis)}</p><p><b>Repair:</b> ${esc(a.final_repair||'Not submitted')}</p><p><b>Correct Repair:</b> ${esc(a.assigned_repair||sim.correctRepair)}</p></div><div class="card"><div class="big">Diagnostic Path</div>${rows||'<p>No actions recorded.</p>'}</div>`,simulationCss()));
});

app.get('/instructor/build-select',auth,async(req,res)=>{
  const q=await pool.query('SELECT id,course,title,code,active FROM classes ORDER BY created_at DESC LIMIT 40');
  const rows=q.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Open':'Closed'}</span></td><td><a class="btn" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Training</a></td></tr>`).join('');
  res.send(layout('Build Test', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Build Test</div><p class="muted">Choose the class whose quiz you want to edit.</p><div style="overflow:auto"><table><tr><th>Course</th><th>Code</th><th>Status</th><th></th></tr>${rows||'<tr><td colspan="4">No classes yet. Start a class first.</td></tr>'}</table></div></div>`));
});


app.get('/instructor/hunt-select',auth,async(req,res)=>{
 const q=await pool.query('SELECT id,course,title,code,active,hunt_tractor_count FROM classes ORDER BY created_at DESC LIMIT 60');
 const rows=q.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="small muted">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td>${c.hunt_tractor_count||3}</td><td><a class="btn" href="/instructor/hunt/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Scavenger Hunt</a></td></tr>`).join('');
 res.send(layout('Scavenger Hunt', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="eyebrow">Dedicated Activity Tab</div><div class="big">Scavenger Hunt</div><p>Choose a class. The scavenger hunt is managed separately from tests and diagnostic simulations.</p><table><tr><th>Class</th><th>Code</th><th>Tractors</th><th></th></tr>${rows||'<tr><td colspan="4">No classes yet.</td></tr>'}</table></div>`));
});
app.get('/instructor/hunt/:id',auth,async(req,res)=>{
 const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found'); const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)); const target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
 const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]); const tq=await pool.query('SELECT tractor_no,model FROM hunt_tractors WHERE class_id=$1 ORDER BY tractor_no',[c.id]); const models=new Map(tq.rows.map(x=>[Number(x.tractor_no),x.model]));
 const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); const balanced=counts.every(n=>n===target);
 const tractorCards=Array.from({length:count},(_,i)=>i+1).map(n=>{
   const model=models.get(n)||'';
   const items=hs.rows.filter(x=>Number(x.tractor_no)===n); const remaining=Math.max(0,target-items.length);
   const selectOptions=['<option value="">— Select Tractor Model —</option>',...HUNT_MODEL_SUGGESTIONS.map(x=>`<option value="${esc(x)}" ${model===x?'selected':''}>${esc(x)}</option>`)].join('');
   const visibleLibrary=model ? HUNT_ITEM_LIBRARY.filter(x=>!x.id.startsWith('refresh_') || is5100RefreshModel(model)).filter(x=>!items.some(h=>(h.item_label||'')===x.label)) : [];
   const itemChecks=visibleLibrary.map(x=>`<label style="font-weight:500;margin:6px 0"><input style="width:auto;margin-right:8px" type="checkbox" name="items" value="${esc(x.id)}">${esc(x.label)}</label>`).join('');
   const modelNote=is5100RefreshModel(model)?`<div class="alert" style="margin:10px 0"><b>Fifty One Hundred Refresh:</b> Refresh-specific hunt items are available below.</div>`:'';
   const status=items.length===target?`<span class="pill results">${items.length}/${target} READY</span>`:`<span class="pill">${items.length}/${target} ITEMS</span>`;
   const huntChooser=!model ? `<div class="alert" style="margin-top:10px"><b>Choose a tractor model first.</b><br>Select a model from the list above and click Save Model. The hunt-item choices will then appear.</div>` : remaining===0 ? `<div class="success" style="margin-top:10px"><b>Tractor ${n} is complete.</b> It has the required ${target} hunt items.</div>` : `<form method="post" action="/instructor/hunt/${c.id}/tractor/${n}/items"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><div class="alert" style="margin:10px 0"><b>Select ${remaining} more item${remaining===1?'':'s'}.</b> Every tractor must have exactly ${target} hunt items.</div>${itemChecks||'<p class="muted">No additional built-in items are available. Use a custom hunt item below if needed.</p>'}<button>Add Selected Hunt Items</button></form>`;
   return `<div class="card"><div class="section-title"><div><div class="eyebrow">TRACTOR ${n}</div><div class="big">${esc(model||'Choose Tractor Model')}</div></div>${status}</div><form method="post" action="/instructor/hunt/${c.id}/tractor/${n}/model"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Tractor Model<select name="model">${selectOptions}</select></label><button>Save Model</button></form><hr>${modelNote}${huntChooser}</div>`
 }).join('');
 const current=hs.rows.map((h,i)=>`<div class="q"><span class="pill">Tractor ${h.tractor_no||'—'}</span> <b>${esc(h.tractor_model||'')} — ${esc(h.item_label||h.station_name)}</b><div class="small muted">${esc(h.task)}</div><form method="post" action="/instructor/hunt/${c.id}/station/${h.id}/delete" style="margin-top:8px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Delete this hunt item?')">Delete Hunt Item</button></form></div>`).join('');
 const balanceText=balanced?`<div class="success" style="margin-top:12px"><b>Balanced Hunt Ready:</b> All ${count} tractor${count===1?'':'s'} have exactly ${target} hunt items.</div>`:`<div class="alert" style="margin-top:12px"><b>Balance Required:</b> Every tractor must have exactly ${target} hunt items. Current counts: ${counts.map((n,i)=>`Tractor ${i+1}: ${n}/${target}`).join(' · ')}</div>`;
 res.send(layout('Scavenger Hunt Builder', `<div class="toolbar"><a class="btn light" href="/instructor/hunt-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Hunt Classes</a><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Class Dashboard</a>${balanced?`<a class="btn" target="_blank" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print Hunt QR Codes</a>`:`<span class="pill">Finish all tractors before printing QR codes</span>`}</div><div class="card"><div class="eyebrow">SCAVENGER HUNT TAB</div><div class="big">${esc(c.course)} · Class ${esc(c.code)}</div><p>Choose the number of tractors and the number of hunt items per tractor. The same item count is enforced on every tractor.</p><div class="grid"><form method="post" action="/instructor/hunt/${c.id}/tractor-count"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>How Many Tractors Will You Use?<select name="tractor_count">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===count?'selected':''}>${n} Tractor${n===1?'':'s'}</option>`).join('')}</select></label><button>Save Tractor Count</button></form><form method="post" action="/instructor/hunt/${c.id}/items-per-tractor"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Hunt Items Per Tractor<select name="items_per_tractor">${Array.from({length:12},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===target?'selected':''}>${n} Item${n===1?'':'s'} Per Tractor</option>`).join('')}</select></label><button>Save Item Count</button></form></div>${balanceText}<div class="alert" style="margin-top:12px"><b>Individual scavenger hunt:</b> Each student scans and completes every station on their own phone. No teams are used.</div></div><div class="grid">${tractorCards}</div><div class="card"><div class="big">Add Custom Hunt Item</div><p class="muted">Custom items also count toward the required ${target} items per tractor.</p><form method="post" action="/instructor/hunt/${c.id}/custom"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Tractor<select name="tractor_no">${Array.from({length:count},(_,i)=>`<option value="${i+1}">Tractor ${i+1}</option>`).join('')}</select></label><label>Item Name<input name="name" required></label><label>Technician Task<textarea name="task" required></textarea></label><label>Expected Answer / Verification<input name="expected" required></label><button>Add Custom Hunt Item</button></form></div><div class="card"><div class="section-title"><div class="big">Current Hunt</div><span class="pill">${hs.rowCount} total items</span></div>${current||'<p>No hunt items have been added yet.</p>'}<form method="post" action="/instructor/hunt/${c.id}/clear"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Clear the entire hunt for this class?')">Clear Entire Hunt</button></form></div>`));
});
app.post('/instructor/hunt/:id/tractor-count',auth,async(req,res)=>{const cid=Number(req.params.id),count=Math.min(5,Math.max(1,Number(req.body.tractor_count)||3));await pool.query('UPDATE classes SET hunt_tractor_count=$2 WHERE id=$1',[cid,count]);await pool.query('DELETE FROM hunt_tractors WHERE class_id=$1 AND tractor_no>$2',[cid,count]);await pool.query('DELETE FROM hunt_stations WHERE class_id=$1 AND COALESCE(tractor_no,999)>$2',[cid,count]);res.redirect(`/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});
app.post('/instructor/hunt/:id/items-per-tractor',auth,async(req,res)=>{const cid=Number(req.params.id),target=Math.min(12,Math.max(1,Number(req.body.items_per_tractor)||5));const q=await pool.query('SELECT tractor_no,count(*)::int n FROM hunt_stations WHERE class_id=$1 GROUP BY tractor_no',[cid]);const tooMany=q.rows.filter(x=>Number(x.n)>target);if(tooMany.length)return res.send(layout('Reduce Hunt Items',`<div class="card"><div class="big">Cannot lower the item count yet</div><div class="alert">Delete extra hunt items first: ${tooMany.map(x=>`Tractor ${x.tractor_no}: ${x.n} items`).join(' · ')}. Then set the new target to ${target}.</div><a class="btn" href="/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Scavenger Hunt</a></div>`));await pool.query('UPDATE classes SET hunt_items_per_tractor=$2 WHERE id=$1',[cid,target]);res.redirect(`/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});
app.post('/instructor/hunt/:id/tractor/:slot/model',auth,async(req,res)=>{const cid=Number(req.params.id),slot=Math.min(5,Math.max(1,Number(req.params.slot)||1)),model=(req.body.model||'').trim();if(model && !HUNT_MODEL_SUGGESTIONS.includes(model)) return res.status(400).send('Choose a tractor model from the list.');await pool.query(`INSERT INTO hunt_tractors(class_id,tractor_no,model) VALUES($1,$2,$3) ON CONFLICT(class_id,tractor_no) DO UPDATE SET model=$3`,[cid,slot,model]);if(!model){await pool.query('DELETE FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2',[cid,slot]);}else{await pool.query('UPDATE hunt_stations SET tractor_model=$3 WHERE class_id=$1 AND tractor_no=$2',[cid,slot,model]);if(!is5100RefreshModel(model)){await pool.query(`DELETE FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2 AND item_label LIKE '5100 Refresh — %'`,[cid,slot]);}}res.redirect(`/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});
app.post('/instructor/hunt/:id/tractor/:slot/items',auth,async(req,res)=>{const cid=Number(req.params.id),slot=Math.min(5,Math.max(1,Number(req.params.slot)||1));const cq=(await pool.query('SELECT hunt_items_per_tractor FROM classes WHERE id=$1',[cid])).rows[0];const target=Math.min(12,Math.max(1,Number(cq?.hunt_items_per_tractor)||5));const mq=(await pool.query('SELECT model FROM hunt_tractors WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0];const model=mq?.model||`Tractor ${slot}`;let ids=req.body.items||[];if(!Array.isArray(ids))ids=[ids];let current=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0].n);for(const id of ids){if(current>=target)break;const item=HUNT_ITEM_LIBRARY.find(x=>x.id===id);if(!item)continue;if(item.id.startsWith('refresh_')&&!is5100RefreshModel(model))continue;const exists=await pool.query('SELECT 1 FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2 AND item_label=$3',[cid,slot,item.label]);if(!exists.rowCount){await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)',[cid,`${model} — ${item.label}`,item.task,item.expected,slot,model,item.label]);current++;}}res.redirect(`/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});
app.post('/instructor/hunt/:id/custom',auth,async(req,res)=>{const cid=Number(req.params.id),slot=Math.min(5,Math.max(1,Number(req.body.tractor_no)||1));const cq=(await pool.query('SELECT hunt_items_per_tractor FROM classes WHERE id=$1',[cid])).rows[0];const target=Math.min(12,Math.max(1,Number(cq?.hunt_items_per_tractor)||5));const current=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0].n);if(current>=target)return res.send(layout('Tractor Hunt Full',`<div class="card"><div class="big">Tractor ${slot} already has ${target} hunt items</div><div class="alert">Delete an existing item before adding another custom item.</div><a class="btn" href="/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Scavenger Hunt</a></div>`));const mq=(await pool.query('SELECT model FROM hunt_tractors WHERE class_id=$1 AND tractor_no=$2',[cid,slot])).rows[0];const model=mq?.model||`Tractor ${slot}`;await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected,tractor_no,tractor_model,item_label) VALUES($1,$2,$3,$4,$5,$6,$7)',[cid,`${model} — ${req.body.name}`,req.body.task,req.body.expected,slot,model,req.body.name]);res.redirect(`/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});
app.post('/instructor/hunt/:id/station/:sid/delete',auth,async(req,res)=>{await pool.query('DELETE FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,req.params.id]);res.redirect(`/instructor/hunt/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});
app.post('/instructor/hunt/:id/clear',auth,async(req,res)=>{const cid=Number(req.params.id);await pool.query('DELETE FROM hunt_stations WHERE class_id=$1',[cid]);await pool.query(`DELETE FROM results WHERE student_id IN (SELECT id FROM students WHERE class_id=$1) AND activity='Scavenger Hunt'`,[cid]);res.redirect(`/instructor/hunt/${cid}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);});

app.get('/instructor/reports',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`);
  const rows=q.rows.map(s=>`<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td>${esc(s.course)}</td><td>${s.activities}</td><td>${s.avg_score}%</td><td class="nowrap"><a class="btn" target="_blank" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print Report</a> <a class="btn light" target="_blank" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Certificate</a></td></tr>`).join('');
  res.send(layout('Print Reports', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Print Student Reports</div><p class="muted">Choose a technician to open their printable training record or certificate.</p><div style="overflow:auto"><table><tr><th>Technician</th><th>Course</th><th>Activities</th><th>Average</th><th></th></tr>${rows||'<tr><td colspan="5">No student records yet.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/settings',auth,async(req,res)=>{
  const q=await pool.query('SELECT course,title,pass_score,hours,instructor,code FROM classes ORDER BY created_at DESC LIMIT 1'); const c=q.rows[0];
  res.send(layout('Settings', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Settings</div><p class="muted">The instructor PIN is securely stored in Render. Passing score and course hours are chosen when each class is created.</p>${c?`<div class="grid"><div class="stat"><span>Last Course</span><b style="font-size:20px">${esc(c.course)}</b></div><div class="stat"><span>Passing Score</span><b>${c.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${c.hours}</b></div></div><p class="small muted">Most recent class: ${esc(c.title)} · Instructor ${esc(c.instructor)} · Code ${esc(c.code)}</p>`:'<p>No classes have been created yet.</p>'}<div class="alert" style="margin-top:18px"><b>Instructor PIN:</b> To change it, update <code>INSTRUCTOR_PIN</code> in Render → Training-Hub → Environment.</div></div>`));
});
app.get('/instructor/new',auth,async(req,res)=>{ const cq=await pool.query('SELECT name FROM course_catalog WHERE active=true ORDER BY name'); const options=cq.rows.map(x=>`<option>${esc(x.name)}</option>`).join(''); res.send(layout('Start Class', `<div class="card"><div class="big">Start a Training Class</div><form method="post" action="/instructor/new"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Class Title<input name="title" placeholder="Example: September Dealer Training" required></label><label>Course<select name="course">${options}</select></label><label>Instructor Name<input name="instructor" required></label><div class="grid"><label>Passing Score<input type="number" name="pass_score" min="1" max="100" value="80"></label><label>Course Hours<input type="number" step="0.5" name="hours" min="0" value="8"></label></div><label><input style="width:auto" type="checkbox" name="student_feedback" value="1" checked> Show missed-question feedback to students after the quiz</label><label><input style="width:auto" type="checkbox" name="show_live_scores" value="1"> Show current scores on the live leaderboard</label><button>Create Class & QR Code</button></form></div>`)); });
app.post('/instructor/new',auth,async(req,res)=>{
  let code; for(let i=0;i<8;i++){ code=code6(); const e=await pool.query('SELECT 1 FROM classes WHERE code=$1',[code]); if(!e.rowCount) break; }
  const token=crypto.randomBytes(16).toString('hex');
  const q=await pool.query('INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,student_feedback,show_live_scores) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[code,req.body.title,req.body.course,req.body.instructor,Number(req.body.pass_score)||80,Number(req.body.hours)||0,token,req.body.student_feedback==='1',req.body.show_live_scores==='1']);
  res.redirect(`/instructor/class/${q.rows[0].id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.get('/instructor/class/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const students=await pool.query(`SELECT s.*,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities,a.activity current_activity,a.status,a.progress,a.total,a.current_score,n.certificate_no,n.certification_status FROM students s LEFT JOIN results r ON r.student_id=s.id LEFT JOIN activity_status a ON a.student_id=s.id LEFT JOIN instructor_notes n ON n.student_id=s.id WHERE s.class_id=$1 GROUP BY s.id,a.activity,a.status,a.progress,a.total,a.current_score,n.certificate_no,n.certification_status ORDER BY s.name`,[c.id]);
  const origin=`${req.protocol}://${req.get('host')}`, joinUrl=`${origin}/c/${c.join_token}`; const qr=await QRCode.toDataURL(joinUrl,{width:420,margin:1});
  const completed=students.rows.filter(s=>s.activities>0).length; const classAvg=completed?Math.round(students.rows.filter(s=>s.activities>0).reduce((a,s)=>a+s.avg_score,0)/completed):0;
  const certs=students.rows.filter(s=>s.certificate_no).length;
  const testing=students.rows.filter(s=>(s.status||'')==='Testing').length;
  const rows=students.rows.map(s=>{const status=s.status||'Joined';const cls=status==='Testing'?'testing':status==='Hunt'?'hunt':s.activities?'results':'joined';const progress=s.total?`${s.progress||0}/${s.total}`:'—';const live=c.show_live_scores&&s.current_score!==null?`${s.current_score}%`:'Hidden';const cert=s.certificate_no?'<span class="pill results">Issued</span>':'<span class="pill">Pending</span>';return `<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td><span class="pill ${cls}">${esc(status)}</span><br><span class="small muted">${esc(s.current_activity||'Joined')}</span></td><td><b>${progress}</b></td><td>${live}</td><td>${s.activities?'<b>'+s.avg_score+'%</b>':'—'}</td><td>${cert}</td><td><a class="btn light" href="/instructor/student/${s.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Student</a></td></tr>`}).join('');
  const liveCss=`<style>
  .live-shell{max-width:1260px;margin:auto}.live-banner{background:linear-gradient(135deg,#171717 0%,#5f0b10 100%);color:#fff;border-radius:22px;padding:25px 28px;border-bottom:6px solid var(--red);box-shadow:0 10px 28px rgba(0,0,0,.12)}.live-banner .eyebrow{color:#ffb7ba}.live-banner h1{margin:5px 0 6px;font-size:34px}.live-banner p{margin:0;color:#eee}.live-banner-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}.version-badge{background:#fff;color:#7e0d12;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900;letter-spacing:.06em}.live-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.live-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}.live-kpi{background:#fff;border:1px solid #e3e3e3;border-radius:16px;padding:16px}.live-kpi span{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666;font-weight:800}.live-kpi b{display:block;font-size:28px;margin-top:5px}.live-main{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}.join-panel{background:#fff;border:1px solid #ddd;border-radius:20px;padding:20px;text-align:center;position:sticky;top:12px}.join-panel .code{font-size:46px}.join-panel .qr{max-width:270px}.leader-card{background:#fff;border:1px solid #ddd;border-radius:20px;overflow:hidden}.leader-head{padding:20px 22px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.leader-head h2{margin:0}.leader-table{overflow:auto}.leader-table table{min-width:850px}.leader-table tbody tr:hover{background:#fffafa}.leader-table th{background:#f7f7f7}.open-state{color:#176b32}.closed-state{color:#9b1b1b}@media(max-width:900px){.live-kpis{grid-template-columns:repeat(2,1fr)}.live-main{grid-template-columns:1fr}.join-panel{position:static}.live-banner h1{font-size:28px}}@media(max-width:520px){.live-kpis{grid-template-columns:1fr 1fr}.live-actions .btn,.live-actions button{flex:1;text-align:center}.join-panel .code{font-size:38px}}
  </style>`;
  res.send(layout('Live Class', `<meta http-equiv="refresh" content="5"><div class="live-shell"><div class="live-banner"><div class="live-banner-top"><div><div class="eyebrow"><span class="live-dot"></span> LIVE CLASS CONTROL · VERSION 5.2</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · Instructor ${esc(c.instructor)}</p></div><span class="version-badge">${c.active?'● CLASS OPEN':'● CLASS CLOSED'}</span></div></div><div class="live-actions no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Command Center</a><a class="btn alt" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Test / Hunt</a><a class="btn" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Print Hunt QR Codes</a><a class="btn light" href="/instructor/class/${c.id}/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Training Feedback</a></div><div class="live-kpis"><div class="live-kpi"><span>Students Joined</span><b>${students.rowCount}</b></div><div class="live-kpi"><span>Testing Now</span><b>${testing}</b></div><div class="live-kpi"><span>With Results</span><b>${completed}</b></div><div class="live-kpi"><span>Class Average</span><b>${completed?classAvg+'%':'—'}</b></div><div class="live-kpi"><span>Certificates Issued</span><b>${certs}</b></div></div><div class="live-main"><div class="join-panel"><div class="eyebrow">Technician Join Code</div><div class="code">${esc(c.code)}</div><img class="qr" src="${qr}" alt="Technician class QR code"><p class="muted small">Scan to join from any phone using Wi-Fi or cellular.</p><div class="success" style="margin:12px 0"><b>${c.active?'Class is open for technicians':'Class is currently closed'}</b></div><form class="no-print" method="post" action="/instructor/class/${c.id}/toggle"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="${c.active?'btn alt':'btn'}" style="width:100%">${c.active?'Close Class':'Reopen Class'}</button></form></div><div class="leader-card"><div class="leader-head"><div><div class="eyebrow">Live Activity</div><h2>Technician Leaderboard</h2></div><span class="muted small">Auto-refreshes every 5 seconds · Live scores ${c.show_live_scores?'ON':'HIDDEN'}</span></div><div class="leader-table"><table><thead><tr><th>Technician</th><th>Status</th><th>Progress</th><th>Live Score</th><th>Completed Avg.</th><th>Certificate</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Waiting for technicians to join...</td></tr>'}</tbody></table></div></div></div></div>`,liveCss));
});
app.post('/instructor/class/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE classes SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/class/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/builder/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const qs=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY id',[c.id]);
  const qcards=qs.rows.map((q,i)=>`<div class="q"><b>${i+1}. ${esc(q.question)}</b>${q.topic?`<div class="small"><span class="pill">${esc(q.topic)}</span></div>`:''}<div class="small muted" style="margin-top:6px">${(q.choices||[]).map((x,j)=>`${String.fromCharCode(65+j)}. ${esc(x)}${j===q.answer_index?' ✓':''}`).join(' · ')}</div>${q.explanation?`<p class="small"><b>Feedback:</b> ${esc(q.explanation)}</p>`:''}<form method="post" action="/instructor/builder/${c.id}/question/${q.id}/delete" style="margin-top:8px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Delete this question?')">Delete Question</button></form></div>`).join('');
  res.send(layout('Test Builder', `<div class="toolbar"><a class="btn light" href="/instructor/hunt/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Scavenger Hunt</a><a class="btn light" href="/instructor/hunt/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Scavenger Hunt Tab</a></div><div class="card"><div class="big">Add Quiz Question</div><form method="post" action="/instructor/builder/${c.id}/question"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Topic / Module<input name="topic"></label><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3"></textarea></label><button>Add Question</button></form><p>${qs.rowCount} question(s) saved.</p>${qcards}</div>`));
});
app.post('/instructor/builder/:id/question',auth,async(req,res)=>{ await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,req.body.question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer),req.body.explanation||'',req.body.topic||'']); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/station',auth,async(req,res)=>{ await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[req.params.id,req.body.name,req.body.task,req.body.expected]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/question/:qid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM quiz_questions WHERE id=$1 AND class_id=$2',[req.params.qid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/station/:sid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/class/:id/hunt-qr',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const count=Math.min(5,Math.max(1,Number(c.hunt_tractor_count)||3)),target=Math.min(12,Math.max(1,Number(c.hunt_items_per_tractor)||5));
  let hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY COALESCE(tractor_no,99),id',[c.id]);
  const counts=Array.from({length:count},(_,i)=>hs.rows.filter(x=>Number(x.tractor_no)===i+1).length); if(!counts.every(n=>n===target))return res.send(layout('Hunt Not Balanced',`<div class="card"><div class="big">Finish the scavenger hunt setup first</div><div class="alert">Every tractor must have exactly ${target} hunt items before QR sheets can be printed. ${counts.map((n,i)=>`Tractor ${i+1}: ${n}/${target}`).join(' · ')}</div><a class="btn" href="/instructor/hunt/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Scavenger Hunt</a></div>`));
  const origin=`${req.protocol}://${req.get('host')}`; const cards=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:320,margin:1}); cards.push(`<div class="card center hunt-qr-card" style="break-inside:avoid"><div class="eyebrow">Scavenger Hunt Station ${i+1}</div><h2>${esc(h.station_name)}</h2><div class="scan-heading">SCAN WITH YOUR PHONE CAMERA</div><img class="qr" src="${qr}" alt="QR code for ${esc(h.station_name)}"><div class="scan-steps"><b>Before you scan:</b> Join the class on this phone first.<br><b>1.</b> Open your phone Camera app.<br><b>2.</b> Point the camera at this QR code.<br><b>3.</b> Tap the Training Hub link that appears.</div><div style="margin:14px 0;padding:12px;border:1px solid #d8d8d8;border-radius:10px;background:#f7f7f7;word-break:break-all"><b>USING A COMPUTER?</b><br>Open this station link:<br><a href="${esc(url)}" target="_blank">${esc(url)}</a></div><p class="station-task"><b>Your task:</b> ${esc(h.task)}</p><p class="small muted">Class ${esc(c.code)} · ${esc(c.course)}</p></div>`)}
  res.send(layout('Scavenger Hunt QR Codes', `<div class="no-print toolbar"><button onclick="window.print()">Print QR Station Sheets</button><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a></div><div class="center"><h1>${esc(c.course)} — Scavenger Hunt QR Codes</h1><p>Print these and place each code at the matching tractor/component station.</p></div><div class="grid">${cards.join('')}</div>`, `<style>.scan-heading{font-weight:900;font-size:18px;letter-spacing:.04em;margin:10px 0 4px}.scan-steps{text-align:left;max-width:420px;margin:10px auto 14px;padding:12px 14px;border:1px solid #d8d8d8;border-radius:10px;line-height:1.6;background:#fafafa}.station-task{text-align:left;max-width:420px;margin:10px auto;line-height:1.45}@media print{.grid{grid-template-columns:1fr 1fr}.card{border:1px solid #999!important;padding:14px!important}.qr{max-width:220px}.scan-heading{font-size:16px}.scan-steps{font-size:12px;line-height:1.45;padding:8px 10px}.station-task{font-size:12px}}</style>`));
});
app.get('/instructor/feedback',auth,async(req,res)=>{
  const q=await pool.query(`SELECT c.id,c.course,c.title,c.code,count(f.student_id)::int responses,round(avg(f.overall)::numeric,1) overall FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN training_feedback f ON f.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 60`);
  const rows=q.rows.map(x=>`<tr><td><b>${esc(x.course)}</b><br><span class="small muted">${esc(x.title)}</span></td><td>${esc(x.code)}</td><td>${x.responses}</td><td>${x.overall||'—'}</td><td><a class="btn light" href="/instructor/class/${x.id}/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">View Feedback</a></td></tr>`).join('');
  res.send(layout('Training Feedback', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Training Feedback</div><p class="muted">Student ratings and comments by class.</p><table><tr><th>Class</th><th>Code</th><th>Responses</th><th>Overall</th><th></th></tr>${rows||'<tr><td colspan="5">No classes yet.</td></tr>'}</table></div>`));
});
app.get('/instructor/class/:id/feedback',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const q=await pool.query(`SELECT f.*,s.name,s.dealer FROM training_feedback f JOIN students s ON s.id=f.student_id WHERE s.class_id=$1 ORDER BY f.submitted_at`,[c.id]);
  const avg=k=>q.rowCount?(q.rows.reduce((a,x)=>a+Number(x[k]),0)/q.rowCount).toFixed(1):'—';
  const comments=q.rows.map(x=>`<div class="card"><b>${esc(x.name)}</b> <span class="muted">· ${esc(x.dealer)}</span><div class="grid" style="margin-top:10px"><div><b>Most Helpful</b><p>${esc(x.most_helpful||'—')}</p></div><div><b>Improve</b><p>${esc(x.improve||'—')}</p></div><div><b>Comments</b><p>${esc(x.comments||'—')}</p></div></div></div>`).join('');
  res.send(layout('Class Feedback', `<div class="no-print toolbar"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Back to Class</a><button onclick="window.print()">Print Feedback Report</button></div><div class="hero"><div><div class="eyebrow">Training Evaluation</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · ${q.rowCount} responses</p></div></div><div class="grid"><div class="stat"><span>Overall Training</span><b>${avg('overall')}</b></div><div class="stat"><span>Instructor</span><b>${avg('instructor')}</b></div><div class="stat"><span>Usefulness</span><b>${avg('usefulness')}</b></div><div class="stat"><span>Hands-On</span><b>${avg('hands_on')}</b></div><div class="stat"><span>Difficulty / Pace</span><b>${avg('difficulty')}</b></div></div>${comments||'<div class="card">No feedback submitted yet.</div>'}`));
});

app.get('/instructor/student/:id',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
  const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0; const skillRows=skills.rows.map(x=>`<label><input style="width:auto" type="checkbox" name="skill_${x.id}" ${x.signed_off?'checked':''}> ${esc(x.skill)}</label>`).join('');
  const resultRows=results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleString()}</td></tr>`).join('');
  const attemptHistory=await getQuizAttemptHistory(s.id);
  const attemptRows=attemptHistory.filter(a=>a.status==='completed').map((a,i)=>`<tr><td>${i+1}</td><td>${a.score}%</td><td>${a.correct_count}/${a.total_questions}</td><td>${new Date(a.completed_at).toLocaleString()}</td><td><a class="btn light" href="/instructor/student/${s.id}/quiz-attempt/${a.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Attempt</a></td></tr>`).join('');
  const latestAttempt=attemptHistory.find(a=>a.status==='completed');
  let quizReview='<div class="muted">No completed quiz attempt yet.</div>';
  if(latestAttempt){ const aRows=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[latestAttempt.id])).rows; quizReview=renderAttemptReview(aRows.map(attemptRowToReviewItem),latestAttempt.score,false); }
  else { const quizResult=[...results.rows].reverse().find(x=>x.activity==='Module Quiz'); if(quizResult){ const oldInfo=await repairQuizReviewData(s.id,quizResult.details||{}); quizReview=oldInfo.legacyIncomplete?'<div class="alert">Legacy attempt: the exact answers were not stored by the older version. New v5.6 attempts are permanent.</div>':renderAttemptReview(oldInfo.review,quizResult.score,false); } }
  const feedback=(await pool.query('SELECT * FROM training_feedback WHERE student_id=$1',[s.id])).rows[0];
  res.send(layout('Student Record', `<div class="toolbar no-print"><a class="btn light" href="/instructor/class/${s.class_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a><a class="btn" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Printable Report</a><a class="btn alt" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Certificate</a></div><div class="card no-print" style="border-color:#e4b4b4"><div class="big danger">Delete Student</div><p class="muted">This permanently removes this student, their scores, skills, comments, and certificate record.</p><form method="post" action="/instructor/student/${s.id}/delete" onsubmit="return confirm('Permanently delete ${esc(s.name)} and all of this student’s results? This cannot be undone.')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger">Delete Student Record</button></form></div><div class="card"><div class="big">${esc(s.name)}</div><p>${esc(s.dealer)} · ${esc(s.course)} · Class ${esc(s.code)}</p><div class="grid"><div class="stat"><span>Overall Average</span><b>${avg}%</b></div><div class="stat"><span>Passing Score</span><b>${s.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${s.hours}</b></div></div></div><div class="card"><div class="big">Activity Results</div><table><tr><th>Activity</th><th>Score</th><th>Completed</th></tr>${resultRows||'<tr><td colspan="3">No completed activities yet.</td></tr>'}</table></div><div class="card"><div class="big">Quiz Review — What the Student Missed</div>${quizReview}</div><div class="card"><div class="big">Quiz Attempt History</div><p class="muted">Every v5.6 quiz attempt is retained permanently.</p><div style="overflow:auto"><table><tr><th>Attempt</th><th>Score</th><th>Correct</th><th>Completed</th><th></th></tr>${attemptRows||'<tr><td colspan="5">No permanent v5.6 attempts yet.</td></tr>'}</table></div></div><div class="card"><div class="big">Training Feedback</div>${feedback?`<p><b>Overall:</b> ${feedback.overall}/5 · <b>Instructor:</b> ${feedback.instructor}/5 · <b>Usefulness:</b> ${feedback.usefulness}/5 · <b>Hands-On:</b> ${feedback.hands_on}/5 · <b>Difficulty/Pace:</b> ${feedback.difficulty}/5</p><p><b>Most helpful:</b> ${esc(feedback.most_helpful||'—')}</p><p><b>Improve:</b> ${esc(feedback.improve||'—')}</p><p><b>Comments:</b> ${esc(feedback.comments||'—')}</p>`:'<p class="muted">No training feedback submitted yet.</p>'}</div><div class="card"><div class="big">Instructor Skills Signoff</div><form method="post" action="/instructor/student/${s.id}/save"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}">${skillRows}<label>Instructor Comments<textarea name="comments" rows="5">${esc(notes.comments||'')}</textarea></label><label>Certification Status<select name="status"><option ${notes.certification_status==='Pending'?'selected':''}>Pending</option><option ${notes.certification_status==='Certified'?'selected':''}>Certified</option><option ${notes.certification_status==='Not Yet Certified'?'selected':''}>Not Yet Certified</option></select></label><button>Save Student Record</button></form></div>`));
});
app.get('/instructor/student/:id/quiz-attempt/:attemptId',auth,async(req,res)=>{
  const q=await pool.query(`SELECT a.*,s.name,s.dealer,c.course,c.code FROM quiz_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1 AND a.student_id=$2`,[req.params.attemptId,req.params.id]);
  const a=q.rows[0]; if(!a) return res.status(404).send('Quiz attempt not found');
  const rows=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[a.id])).rows;
  const review=rows.map(attemptRowToReviewItem);
  res.send(layout('Quiz Attempt', `<div class="toolbar"><a class="btn light" href="/instructor/student/${a.student_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Student Record</a></div><div class="card"><div class="eyebrow">Permanent Quiz Attempt #${a.id}</div><div class="big">${esc(a.name)} · ${esc(a.course)}</div><p>${esc(a.dealer)} · Class ${esc(a.code)} · Completed ${a.completed_at?new Date(a.completed_at).toLocaleString():'Not completed'}</p></div>${renderAttemptReview(review,a.score,true)}`));
});

app.post('/instructor/student/:id/save',auth,async(req,res)=>{
  const skills=await pool.query('SELECT id FROM skills WHERE student_id=$1',[req.params.id]); for(const x of skills.rows){ const on=!!req.body['skill_'+x.id]; await pool.query('UPDATE skills SET signed_off=$1,signed_by=$2,signed_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$3',[on,'Instructor',x.id]); }
  const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[req.params.id]); const cert=(existing.rows[0]?.certificate_no)||certNo();
  await pool.query(`INSERT INTO instructor_notes(student_id,comments,certification_status,certificate_no) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET comments=excluded.comments,certification_status=excluded.certification_status,certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[req.params.id,req.body.comments||'',req.body.status||'Pending',cert]);
  res.redirect(`/instructor/student/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.post('/instructor/student/:id/delete',auth,async(req,res)=>{ const q=await pool.query('SELECT class_id,name FROM students WHERE id=$1',[req.params.id]); if(!q.rowCount) return res.status(404).send('Student not found'); const classId=q.rows[0].class_id; await pool.query('DELETE FROM students WHERE id=$1',[req.params.id]); res.send(layout('Student Deleted', `<div class="card center"><div class="big">Student Deleted</div><p>${esc(q.rows[0].name)} and all associated training records were removed.</p><a class="btn" href="/instructor/class/${classId}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Return to Class</a> <a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Student Records</a></div>`)); });

app.get('/instructor/student/:id/report',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{}; const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0;
  const reportAttempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[s.id])).rows[0];
  let missedRows='';
  if(reportAttempt){ const ar=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[reportAttempt.id])).rows.map(attemptRowToReviewItem); missedRows=ar.filter(x=>!x.is_correct).map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question)}</b><p><b>Student Answer:</b> ${esc(m.selected)}<br><b>Correct Answer:</b> ${esc(m.correct)}<br><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join(''); } else { const quizResultReport=[...results.rows].reverse().find(x=>x.activity==='Module Quiz'); if(quizResultReport){ const reviewReport=await repairQuizReviewData(s.id,quizResultReport.details||{}); missedRows=reviewReport.missed.length?reviewReport.missed.map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question||'Question text was not retained')}</b><p><b>Student Answer:</b> ${esc(m.selected||'Previous selected answer was not recorded')}<br><b>Correct Answer:</b> ${esc(m.correct||'Correct answer could not be recovered')}<br><b>Explanation:</b> ${esc(m.explanation||'Review this topic with your instructor.')}</p></div>`).join(''):'<div class="alert">Legacy attempt: no recoverable question snapshot was stored.</div>'; } }
  res.send(layout('Student Report', `<div class="report"><div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="center"><h1>${esc((await pool.query("SELECT value FROM site_settings WHERE key='organization_name'")).rows[0]?.value||'Mahindra Technician Training')} Record</h1><p>${esc(s.course)}</p></div><div class="card"><table><tr><th>Technician</th><td>${esc(s.name)}</td><th>Dealer</th><td>${esc(s.dealer)}</td></tr><tr><th>Instructor</th><td>${esc(s.instructor)}</td><th>Class Code</th><td>${esc(s.code)}</td></tr><tr><th>Course Hours</th><td>${s.hours}</td><th>Overall Average</th><td><b>${avg}%</b></td></tr><tr><th>Passing Score</th><td>${s.pass_score}%</td><th>Status</th><td><b>${esc(notes.certification_status|| (avg>=s.pass_score?'PASS':'REVIEW'))}</b></td></tr><tr><th>Certificate No.</th><td colspan="3">${esc(notes.certificate_no||'Pending')}</td></tr></table></div><div class="card"><h2>Activity Results</h2><table><tr><th>Activity</th><th>Score</th><th>Date</th></tr>${results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleDateString()}</td></tr>`).join('')}</table></div><div class="card"><h2>Quiz Review — Missed Questions</h2>${missedRows||'<p>No missed questions recorded.</p>'}</div><div class="card"><h2>Practical Skills</h2>${skills.rows.map(x=>`<p>☐ ${x.signed_off?'✓ ':''}${esc(x.skill)} ${x.signed_off?`— Verified by ${esc(x.signed_by||'Instructor')}`:''}</p>`).join('')}</div><div class="card"><h2>Instructor Comments</h2><p>${esc(notes.comments||'')}</p><div style="margin-top:50px;display:flex;gap:60px"><div style="flex:1;border-top:1px solid #000;padding-top:5px">Technician Signature</div><div style="flex:1;border-top:1px solid #000;padding-top:5px">Instructor Signature</div></div></div></div>`, `<script>window.addEventListener('load',()=>{});</script>`));
});

function attemptRowToReviewItem(row){
  return {question:row.question_text||'',topic:row.topic||'',choices:Array.isArray(row.choices)?row.choices:[],selected_index:row.selected_index,answer_index:row.correct_index,selected:row.selected_answer||'No answer',correct:row.correct_answer||'',explanation:row.explanation||'Review this topic with your instructor.',is_correct:row.is_correct===true};
}
function renderAttemptReview(review=[],score=null,showAll=true){
  const missed=review.filter(x=>!x.is_correct), source=showAll?review:missed;
  const rows=source.map((m,i)=>`<div class="q ${m.is_correct?'feedback-good':'feedback-miss'}"><b>${m.is_correct?'Correct':'Missed'} · Question ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question)}</p><p><b>Student Answer:</b> ${esc(m.selected||'No answer')}</p><p><b>Correct Answer:</b> ${esc(m.correct)}</p><p><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join('');
  return `<div class="card" style="border-top:5px solid var(--red)"><div class="big">Answer Review</div><p class="muted">Score: <b>${score===null?'—':score+'%'}</b> · Missed: <b>${missed.length}</b>. Every question is stored as a snapshot and remains available even if the quiz is edited later.</p>${rows||'<div class="success">No stored questions for this attempt.</div>'}</div>`;
}
async function getQuizAttemptHistory(studentId){
  return (await pool.query(`SELECT id,score,correct_count,total_questions,started_at,completed_at,status FROM quiz_attempts WHERE student_id=$1 ORDER BY COALESCE(completed_at,started_at) DESC,id DESC`,[studentId])).rows;
}

function formatCertDate(d){
  return new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
}
function quizReviewData(details={}){
  const review=Array.isArray(details.review)?details.review:[];
  let missed=Array.isArray(details.missed)?details.missed:[];
  if(!missed.length && review.length) missed=review.filter(x=>!x?.is_correct);
  const normalizedReview=review.length?review:(missed.length?missed.map(x=>({...x,is_correct:false})):[]);
  return {review:normalizedReview, missed};
}
async function repairQuizReviewData(studentId,details={}){
  const student=(await pool.query('SELECT class_id FROM students WHERE id=$1',[studentId])).rows[0];
  const classId=student?.class_id;
  const info=quizReviewData(details);

  // First use complete review objects already stored in the old result.
  const existing=[];
  for(const raw of info.review){
    if(typeof raw==='string'){
      existing.push({question:raw,topic:'',selected:'Previous selected answer was not recorded',correct:'',explanation:'',is_correct:false});
    }else if(raw && typeof raw==='object'){
      existing.push({
        question:String(raw.question||''), topic:String(raw.topic||''),
        selected:String(raw.selected||raw.student_answer||'Previous selected answer was not recorded'),
        correct:String(raw.correct||raw.correct_answer||''),
        explanation:String(raw.explanation||''), is_correct:!!raw.is_correct
      });
    }
  }
  if(!existing.length && Array.isArray(details.missed)){
    for(const raw of details.missed){
      if(typeof raw==='string') existing.push({question:raw,topic:'',selected:'Previous selected answer was not recorded',correct:'',explanation:'',is_correct:false});
      else if(raw && typeof raw==='object') existing.push({question:String(raw.question||''),topic:String(raw.topic||''),selected:String(raw.selected||raw.student_answer||'Previous selected answer was not recorded'),correct:String(raw.correct||raw.correct_answer||''),explanation:String(raw.explanation||''),is_correct:false});
    }
  }

  // Recover missing question/correct-answer text from the current class question bank when possible.
  if(classId && existing.length){
    const bank=(await pool.query('SELECT question,choices,answer_index,explanation,topic FROM quiz_questions WHERE class_id=$1',[classId])).rows;
    for(const item of existing){
      let match=null;
      if(item.question){
        const qnorm=item.question.trim().toLowerCase();
        match=bank.find(q=>String(q.question||'').trim().toLowerCase()===qnorm);
      }
      if(match){
        const choices=Array.isArray(match.choices)?match.choices:[];
        if(!item.correct) item.correct=choices[match.answer_index]||'';
        if(!item.explanation) item.explanation=match.explanation||'Review this topic with your instructor.';
        if(!item.topic) item.topic=match.topic||'';
      }
    }
    const useful=existing.filter(x=>x.question && x.correct);
    if(useful.length) return {review:existing,missed:existing.filter(x=>!x.is_correct),legacyIncomplete:existing.some(x=>!x.question||!x.correct)};
  }

  // Older versions kept the latest per-question progress separately. Recover it when still available.
  const q=await pool.query(`SELECT qp.is_correct,qp.selected_answer,qq.question,qq.choices,qq.answer_index,qq.explanation,qq.topic FROM quiz_progress qp JOIN quiz_questions qq ON qq.id=qp.question_id WHERE qp.student_id=$1 ORDER BY qp.updated_at,qq.id`,[studentId]);
  if(q.rowCount){
    const review=q.rows.map(x=>({question:x.question||'',topic:x.topic||'',selected:Number.isInteger(x.selected_answer)?(x.choices?.[x.selected_answer]||'Previous selected answer was not recorded'):'Previous selected answer was not recorded',correct:x.choices?.[x.answer_index]||'',explanation:x.explanation||'Review this topic with your instructor.',is_correct:!!x.is_correct})).filter(x=>x.question&&x.correct);
    if(review.length) return {review,missed:review.filter(x=>!x.is_correct),legacyIncomplete:false};
  }

  // If old details contained a question string but it no longer exists in the bank, preserve the text and be explicit.
  if(existing.length){
    return {review:existing,missed:existing.filter(x=>!x.is_correct),legacyIncomplete:true};
  }
  return {review:[],missed:[],legacyIncomplete:true};
}
function renderQuizReview(details={}, opts={}){
  const score=opts.score ?? null;
  const showAll=opts.showAll!==false;
  const {review, missed}=quizReviewData(details);
  const source=(showAll && review.length)?review:missed;
  const rows=source.map((m,i)=>`<div class="q ${m.is_correct?'feedback-good':'feedback-miss'}"><b>${m.is_correct?'Correct':'Missed'} Question ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question||'')}</p><p><b>Your Answer:</b> ${esc(m.selected||'No answer')}</p><p><b>Correct Answer:</b> ${esc(m.correct||'')}</p><p><b>Explanation:</b> ${esc(m.explanation||'Review this topic with your instructor.')}</p></div>`).join('');
  return `<div class="card" style="border-top:5px solid var(--red)"><div class="big">Quiz Review</div><p class="muted">Questions missed: <b>${missed.length}</b>${score!==null?` · Score: <b>${score}%</b>`:''}. ${showAll?'All questions are shown below, with missed ones highlighted in red.':'Missed questions are shown below.'}</p>${rows||'<div class="success"><b>Perfect score.</b> You did not miss any questions.</div>'}</div>`;
}

function certificateMarkup(s, cert, startDate, endDate, backHref=''){
  const backBtn=backHref?`<a class="btn light" href="${esc(backHref)}">Back</a>`:'';
  return {
    body:`<div class="no-print toolbar cert-toolbar"><button onclick="window.print()">Print / Save PDF</button>${backBtn}</div>
    <div class="cert-stage">
      <div class="mahindra-cert">
        <img class="cert-logo" src="${MAHINDRA_LOGO_DATA_URI}" alt="Mahindra Rise">
        <div class="cert-title">MAHINDRA Ag North America</div>
        <div class="cert-intro">This is to certify that</div>
        <div class="cert-name">${esc(s.name)}</div>
        <div class="cert-name-line"></div>
        <div class="cert-of">of</div>
        <div class="cert-dealer">${esc(s.dealer)}</div>
        <div class="cert-dealer-line"></div>
        <div class="cert-success">has successfully completed</div>
        <div class="cert-course-label">Technical Training on</div>
        <div class="cert-course">${esc(s.course)}</div>
        <div class="cert-course-line"></div>
        <div class="cert-location">Conducted at Mahindra AG North America,</div>
        <div class="cert-dates"><span>From</span><span class="cert-date">${esc(startDate)}</span><span>to</span><span class="cert-date">${esc(endDate)}</span></div>

        <div class="sig-block instructor-signature-block">
          <div class="typed-signature">${esc(s.instructor)}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${esc(s.instructor)}</div>
          <div>Instructor</div>
          <div>Mahindra Ag North America</div>
        </div>

        <div class="sig-block nazar-signature-block">
          <img class="manager-signature" src="${NAZAR_SIGNATURE_DATA_URI}" alt="Nazar Mohamed signature">
          <div class="sig-line"></div>
          <div class="sig-name">Nazar Mohamed</div>
          <div>National Aftersales Manager</div>
          <div>Mahindra Ag North America</div>
        </div>

        <div class="cert-number">Certificate No. ${esc(cert)}</div>
      </div>
    </div>`,
    css:`<style>
      body{background:#ececec}
      .wrap{max-width:none!important;padding:18px!important}
      .cert-toolbar{max-width:1180px;margin:0 auto 10px}
      .cert-stage{width:100%;overflow:auto;display:flex;justify-content:center;align-items:flex-start}
      .mahindra-cert{position:relative;width:1180px;height:912px;min-width:1180px;background:#fff;border:1px solid #d7d7d7;box-shadow:0 4px 18px rgba(0,0,0,.12);font-family:Georgia,'Times New Roman',serif;color:#111;overflow:hidden}
      .cert-logo{position:absolute;left:62px;top:30px;width:210px;height:auto;object-fit:contain}
      .cert-title{position:absolute;left:250px;right:120px;top:34px;text-align:center;font-size:42px;font-weight:700;line-height:1.05}
      .cert-intro{position:absolute;left:0;right:0;top:132px;text-align:center;font-style:italic;font-size:29px}
      .cert-name{position:absolute;left:170px;right:170px;top:188px;text-align:center;color:#0b43a0;font-size:45px;font-weight:700;line-height:1.05}
      .cert-name-line{position:absolute;left:150px;right:150px;top:246px;border-top:2px solid #222}
      .cert-of{position:absolute;left:64px;top:292px;font-style:italic;font-size:27px}
      .cert-dealer{position:absolute;left:145px;right:90px;top:276px;text-align:center;color:#0b43a0;font-size:35px;font-weight:700}
      .cert-dealer-line{position:absolute;left:150px;right:150px;top:326px;border-top:2px solid #222}
      .cert-success{position:absolute;left:0;right:0;top:360px;text-align:center;font-style:italic;font-size:29px}
      .cert-course-label{position:absolute;left:170px;top:430px;font-style:italic;font-size:27px}
      .cert-course{position:absolute;left:480px;right:170px;top:414px;text-align:center;color:#0b43a0;font-size:32px;font-weight:700;line-height:1.1}
      .cert-course-line{position:absolute;left:470px;right:150px;top:458px;border-top:2px solid #222}
      .cert-location{position:absolute;left:0;right:0;top:495px;text-align:center;font-style:italic;font-size:27px}
      .cert-dates{position:absolute;left:0;right:0;top:552px;display:flex;justify-content:center;align-items:flex-end;gap:16px;font-style:italic;font-size:25px}
      .cert-date{min-width:240px;text-align:center;color:#0b43a0;font-style:normal;font-weight:700;border-bottom:2px solid #222;padding:0 8px 4px}
      .sig-block{position:absolute;width:360px;height:150px;text-align:center;font-family:Arial,sans-serif;font-size:16px;line-height:1.15}
      .instructor-signature-block{left:115px;top:650px}
      .nazar-signature-block{right:115px;top:650px}
      .typed-signature{height:64px;display:flex;align-items:flex-end;justify-content:center;font-family:'Segoe Script','Brush Script MT',cursive;font-size:34px;font-style:italic;line-height:1;margin:0 auto -8px;position:relative;z-index:2;background:transparent}
      .manager-signature{display:block;width:285px;height:74px;object-fit:contain;object-position:center;filter:none;margin:0 auto -18px;position:relative;z-index:2;background:transparent}
      .sig-line{border-top:2px solid #222;margin:0 auto 10px;width:330px;max-width:330px;position:relative;z-index:1}
      .sig-name{font-size:18px;font-weight:700}
      .cert-number{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-family:Arial,sans-serif;color:#444;font-size:14px;font-weight:600}
      @media(max-width:1215px){.cert-stage{justify-content:flex-start}}
      @media print{
        @page{size:11in 8.5in landscape;margin:.25in}
        html,body{width:11in;height:8.5in;margin:0!important;padding:0!important;background:#fff!important}
        .top,.no-print{display:none!important}
        .wrap{width:10.5in!important;height:8in!important;max-width:none!important;margin:0!important;padding:0!important}
        .cert-stage{display:block!important;width:10.5in!important;height:8in!important;overflow:hidden!important;margin:0!important;padding:0!important}
        .mahindra-cert{width:10.5in!important;height:8in!important;min-width:0!important;margin:0!important;border:0!important;box-shadow:none!important;transform:none!important}
        .cert-logo{left:.42in;top:.22in;width:1.85in}
        .cert-title{left:2.2in;right:.75in;top:.27in;font-size:30pt}
        .cert-intro{top:1.15in;font-size:21pt}
        .cert-name{left:1.45in;right:1.45in;top:1.63in;font-size:32pt}
        .cert-name-line{left:1.3in;right:1.3in;top:2.15in}
        .cert-of{left:.5in;top:2.55in;font-size:20pt}
        .cert-dealer{left:1.25in;right:.75in;top:2.4in;font-size:25pt}
        .cert-dealer-line{left:1.3in;right:1.3in;top:2.85in}
        .cert-success{top:3.15in;font-size:21pt}
        .cert-course-label{left:1.45in;top:3.75in;font-size:19pt}
        .cert-course{left:4.25in;right:1.35in;top:3.6in;font-size:23pt}
        .cert-course-line{left:4.08in;right:1.3in;top:4.0in}
        .cert-location{top:4.32in;font-size:20pt}
        .cert-dates{top:4.85in;font-size:18pt;gap:.13in}
        .cert-date{min-width:2.05in;padding-bottom:.03in}
        .sig-block{width:3.25in;height:1.35in;font-size:11.5pt}
        .instructor-signature-block{left:.98in;top:5.58in}
        .nazar-signature-block{right:.98in;top:5.58in}
        .typed-signature{height:.55in;font-size:24pt;margin:0 auto -.07in;position:relative;z-index:2;background:transparent}
        .manager-signature{width:2.55in;height:.68in;filter:none;margin:0 auto -.13in;position:relative;z-index:2;background:transparent}
        .sig-line{width:3.0in;max-width:3.0in;margin:0 auto .08in;position:relative;z-index:1}
        .sig-name{font-size:13pt}
        .cert-number{bottom:.08in;font-size:9.5pt;color:#444;font-weight:600}
      }
    </style>`
  };
}

app.get('/student/:id/certificate', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const qr=await pool.query("SELECT score,completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[s.id]);
  if(!qr.rowCount) return res.status(403).send(layout('Certificate Not Available','<div class="card">Complete the test first.</div>'));
  const score=Number(qr.rows[0].score);
  if(score<s.pass_score) return res.status(403).send(layout('Certificate Not Available',`<div class="card"><div class="alert">A passing score of ${s.pass_score}% is required. Your latest score is ${score}%.</div></div>`));
  const cert=await ensureCertificate(s.id);
  const cq=(await pool.query('SELECT created_at FROM classes WHERE id=$1',[s.class_id])).rows[0];
  const startDate=formatCertDate(cq?.created_at||qr.rows[0].completed_at);
  const endDate=formatCertDate(qr.rows[0].completed_at);
  const certView=certificateMarkup(s,cert,startDate,endDate,`/student/${s.id}?token=${encodeURIComponent(s.join_token)}`);
  res.send(layout('My Certificate',certView.body,certView.css));
});

app.get('/instructor/student/:id/certificate',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.instructor,c.hours,c.created_at FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]);
  const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const quiz=(await pool.query("SELECT completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[s.id])).rows[0];
  const cert=await ensureCertificate(s.id);
  const startDate=formatCertDate(s.created_at||quiz?.completed_at||new Date());
  const endDate=formatCertDate(quiz?.completed_at||new Date());
  const certView=certificateMarkup(s,cert,startDate,endDate,'');
  res.send(layout('Certificate',certView.body,certView.css));
});
app.get('/instructor/history',auth,async(req,res)=>{
  const term=(req.query.q||'').trim(); const params=[]; let where=''; if(term){params.push('%'+term+'%'); where='WHERE s.name ILIKE $1 OR s.dealer ILIKE $1 OR c.course ILIKE $1';}
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id ${where} GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`,params);
  res.send(layout('Student Records', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Dashboard</a></div><div class="card"><div class="big">Student Records</div><form method="get"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Search technician, dealer, or course<input name="q" value="${esc(term)}"></label><button>Search</button></form><table><tr><th>Technician</th><th>Dealer</th><th>Course</th><th>Average</th><th></th></tr>${q.rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.dealer)}</td><td>${esc(x.course)}</td><td>${x.avg_score}%</td><td class="nowrap"><a class="btn light" href="/instructor/student/${x.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open</a> <form method="post" action="/instructor/student/${x.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(x.name)} and ALL associated results?')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" style="padding:10px 12px">Delete</button></form></td></tr>`).join('')}</table></div>`));
});


app.get('/instructor/admin',auth,async(req,res)=>{
  const courses=await pool.query('SELECT * FROM course_catalog ORDER BY active DESC,name');
  const settingsQ=await pool.query('SELECT key,value FROM site_settings'); const settings=Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]));
  const courseRows=courses.rows.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Active':'Archived'}</span></td><td class="nowrap"><form method="post" action="/instructor/admin/course/${c.id}/toggle" style="display:inline"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="btn light">${c.active?'Archive':'Restore'}</button></form> <form method="post" action="/instructor/admin/course/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this course name from the catalog? Existing classes will not be deleted.')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger">Delete</button></form></td></tr>`).join('');
  res.send(layout('Admin Content Editor', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="hero"><div><div class="eyebrow">Admin</div><h1>Content Editor</h1><p class="muted">Change the training system from here instead of editing GitHub code.</p></div></div><div class="grid"><div class="card"><div class="big">Website Wording</div><form method="post" action="/instructor/admin/settings"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Instructor Home Message<textarea name="home_message" rows="3">${esc(settings.home_message||'')}</textarea></label><label>Organization / Report Name<input name="organization_name" value="${esc(settings.organization_name||'')}"></label><label>Certificate Title<input name="certificate_title" value="${esc(settings.certificate_title||'Certificate of Completion')}"></label><button>Save Website Content</button></form></div><div class="card"><div class="big">Add Course</div><form method="post" action="/instructor/admin/course"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Course Name<input name="name" placeholder="Example: 4600 Series Diagnostics" required></label><button>Add Course</button></form><p class="small muted">New active courses immediately appear in Start Class.</p></div></div><div class="card"><div class="section-title"><h2>Course Catalog</h2><span class="muted small">Archive hides a course without removing old class records.</span></div><div style="overflow:auto;margin-top:12px"><table><tr><th>Course</th><th>Status</th><th>Actions</th></tr>${courseRows}</table></div></div><div class="card"><div class="big">Training Content</div><p>Questions and scavenger hunts are managed in separate instructor tabs.</p><a class="btn" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Test / Hunt Builder</a> <a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Manage Students</a></div>`));
});
app.post('/instructor/admin/settings',auth,async(req,res)=>{ for(const key of ['home_message','organization_name','certificate_title']){ const value=(req.body[key]||'').trim(); await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]); } res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course',auth,async(req,res)=>{ const name=(req.body.name||'').trim(); if(name) await pool.query('INSERT INTO course_catalog(name,active) VALUES($1,true) ON CONFLICT(name) DO UPDATE SET active=true',[name]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE course_catalog SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course/:id/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM course_catalog WHERE id=$1',[req.params.id]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.listen(port,'0.0.0.0',()=>console.log(`${APP_NAME} running on port ${port}`));
