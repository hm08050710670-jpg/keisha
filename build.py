#!/usr/bin/env python3
"""src/ の部品から2つの成果物を作る:
  dist/artifact.html            … 公開ページ用（<html>/<head> なし）
  dist/golf-guts-putt-lab.html  … 単体で動く完全なHTML（https に置けばセンサーも使える）
"""
import pathlib
root = pathlib.Path(__file__).parent
src = lambda n: (root / 'src' / n).read_text(encoding='utf-8')
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap">'
page = ('<title>GOLF GUTS PUTT LAB</title>\n' + FONTS + '\n<style>\n' + src('style.css') + '</style>\n\n'
        + src('body.html') + '\n<script>\n' + src('physics.js') + '</script>\n<script>\n' + src('app.js') + '</script>\n')
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'artifact.html').write_text(page, encoding='utf-8')
head = ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="theme-color" content="#0a2417">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
        '<meta name="apple-mobile-web-app-title" content="PUTT LAB">\n'
        '<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n')
(root / 'dist' / 'golf-guts-putt-lab.html').write_text(head + page + '</body>\n</html>\n', encoding='utf-8')
(root / 'index.html').write_text(head + page + '</body>\n</html>\n', encoding='utf-8')  # GitHub Pages が配信するファイル
print('built', {p.name: p.stat().st_size for p in (root / 'dist').iterdir()})
