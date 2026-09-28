import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandLayout} from './hall-model.mjs';
import {renderHallPage} from './hall-page.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), input=args[0], outIndex=args.indexOf('--out');
if(!input){console.error('Usage: node tools/build-hall.mjs draft.json [--out NEW_DIRECTORY]');process.exit(1);}
try {
 const d=JSON.parse(fs.readFileSync(input,'utf8'));
 const {positions,seats}=expandLayout(d);
 const out=path.resolve(outIndex<0?path.join(root,'hall-output',d.id):args[outIndex+1]||'');
 if(fs.existsSync(out))throw Error('出力先が既に存在します。既存データを守るため新しいフォルダを指定してください');
 const hall={id:d.id,name:d.name,prefecture:d.prefecture,city:d.city,floor:'スロット',seat_count:seats.length,updated_at:d.layout_date,layout_updated_at:d.layout_date,preserve_layout:true,source:{name:d.minrepo_url?'みんレポ':'FLOOR777島図ビルダー',url:d.minrepo_url||'',note:'台番号配置は提供資料から作成。機種確認中の台は収集結果との照合が必要。'},seats};
 const html=renderHallPage(hall,{
   positionFile:`positions-${d.id}.json`,
   sourceNote:'<div class="status-note"><span class="status-dot"></span><span>機種名・台データは <a class="source-link" id="sourceLink" rel="noopener noreferrer" target="_blank"><span id="sourceName">参照元</span></a> から取得します（最終データ <span id="sourceDate">—</span>）。配置・台番号は公開前に確認してください。</span></div>',
   robotsMeta:'<meta name="robots" content="noindex,nofollow"/>'
 });
 const registration={id:d.id,name:d.name,prefecture:d.prefecture,city:d.city,category:'スロット',seat_count:seats.length,updated_at:d.layout_date,path:`halls/${d.id}/`,status:'draft',features:['機種名検索','台番号検索','島図','向き切替']};
 const collector={[d.id]:{name:d.name,collector:'minrepo',tag_url:d.minrepo_url,source_name:'みんレポ',source_url:d.minrepo_url,expected_machine_count:seats.length,backfill_reports:6,public_days:14,public_filename:`${d.id}-stats.json`}};
 const write=(p,text)=>{const target=path.join(out,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 const json=(p,obj)=>write(p,JSON.stringify(obj,null,2)+'\n');
 json(`data/${d.id}.json`,hall);json(`data/positions-${d.id}.json`,positions);write(`halls/${d.id}/index.html`,html);
 json('registration.json',registration);if(d.minrepo_url)json('collector-entry.json',collector);json('layout-draft.json',{...d,image:null});
 write('CHECKLIST.md',`# ${d.name} 公開前確認\n\n- 台数 ${seats.length}、欠番、左右・上下の向き、通路を元画像と照合。\n- data と halls の生成ファイルだけを本体へコピー。既存店舗は上書きしない。共通 assets は本体を使う。\n- registration.json の項目を data/halls.json の halls に追加。draft の間は一覧非表示。URLを知る人は閲覧できるので秘密情報は置かない。\n- collector-entry.json がある場合は非公開 floor777-data の halls.json に追加。既存店舗の設定を残す。\n- 収集の実行・成功と本体への転送を確認。URLだけではデータ収集は開始されない。\n- 初回収集JSONの台番号と配置番号を照合。機種名を店舗JSONに反映し、機種確認中を解消。公開データが機種検索・差枚に正しく反映されることを確認。\n- 検索・差枚・狙い台・スマホ操作を実機確認。\n- 公開するときに status を published、ページの noindex メタタグを削除、sitemap.xml に店舗URLを追加。\n- 元画像は同梱されない。共有・公開の利用条件を確認。\n`);
 console.log(`${seats.length}台の店舗プレビューを生成しました：${out}\n公開・収集設定は変更していません。CHECKLIST.mdを確認してください。`);
} catch(e){console.error(e.message);process.exitCode=1;}
