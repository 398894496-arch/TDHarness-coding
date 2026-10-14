window.__ModuleLoader__.load({
	id: "company-grok-media",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// 局部修改：对话里的图片悬停出「局部修改」，点开是标注画布。员工涂出要改的地方、写改成什么；
		// 这里把标注区域连同一圈留边裁成标准比例（xAI 改图会把输出对齐到标准比例），交给
		// /company/media/region-edit 改，结果按原比例缩回、校正整体色调、按标注形状羽化贴回原图。
		// 羽化边以外的像素与原图逐像素相同：xAI 的改图接口没有蒙版参数，精准只能在这里保证。
		const inject = [];
		const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
		const RATIOS = [
			["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["3:2", 3 / 2], ["2:3", 2 / 3],
			["16:9", 16 / 9], ["9:16", 9 / 16], ["2:1", 2], ["1:2", 0.5],
		];
		const MAX_SIDE = 4096; // 底图最长边：再大的图先缩到这里，免得浏览器内存吃不住
		const SEND_SIDE = 2048; // 送去改的裁片最长边
		const MIN_IMG = 160; // 小于这个的图（图标、头像）不挂按钮

		// ---- 纯几何，selftest 用 ----

		// 标注外框 -> 送去改的裁剪框：四周留边，扩到最接近的标准比例，不出图。
		// 返回 { x, y, w, h }（原图里裁哪块）和 { pw, ph, ox, oy }（送出去的画布多大、裁片放在哪）：
		// 平常两者一样；图里放不下任何标准比例时（标注几乎占满一张比例少见的图），裁片四周补边凑成
		// 标准比例，改完把补的边切掉，不拉伸。
		function cropBox(bbox, W, H) {
			const side = Math.max(bbox.w, bbox.h);
			const margin = Math.max(32, Math.round(side * 0.25));
			let x0 = Math.max(0, bbox.x - margin);
			let y0 = Math.max(0, bbox.y - margin);
			let x1 = Math.min(W, bbox.x + bbox.w + margin);
			let y1 = Math.min(H, bbox.y + bbox.h + margin);
			// 太小的框没有上下文，模型改不好：至少 256（图本身更小就整张）。
			const minW = Math.min(256, W), minH = Math.min(256, H);
			if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = Math.max(0, Math.min(W - minW, c - minW / 2)); x1 = x0 + minW; }
			if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = Math.max(0, Math.min(H - minH, c - minH / 2)); y1 = y0 + minH; }
			const want = { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
			const aspect = want.w / want.h;
			const order = RATIOS.slice().sort((a, b) => Math.abs(Math.log(a[1] / aspect)) - Math.abs(Math.log(b[1] / aspect)));
			for (let i = 0; i < order.length; i++) {
				const r = order[i][1];
				const w = Math.round(Math.max(want.w, want.h * r));
				const h = Math.round(w / r);
				if (w > W || h > H) continue;
				let x = Math.round(want.cx - w / 2);
				let y = Math.round(want.cy - h / 2);
				x = Math.min(Math.max(0, x), W - w);
				y = Math.min(Math.max(0, y), H - h);
				// 必须盖住标注本身（留边可以因为贴边被压缩）。
				if (x > bbox.x || y > bbox.y || x + w < bbox.x + bbox.w || y + h < bbox.y + bbox.h) continue;
				return { x, y, w, h, ratio: order[i][0], pw: w, ph: h, ox: 0, oy: 0 };
			}
			const x = Math.round(x0), y = Math.round(y0);
			const w = Math.round(x1) - x, h = Math.round(y1) - y;
			const r = order[0][1];
			let pw = w, ph = h;
			if (w / h < r) pw = Math.round(h * r); else ph = Math.round(w / r);
			return { x, y, w, h, ratio: order[0][0], pw, ph, ox: Math.floor((pw - w) / 2), oy: Math.floor((ph - h) / 2) };
		}

		// RGBA 的 alpha 通道 -> 有标注的外框；没有标注返回 null。
		function alphaBox(data, W, H) {
			let minX = W, minY = H, maxX = -1, maxY = -1;
			for (let y = 0; y < H; y++) {
				const row = y * W * 4;
				for (let x = 0; x < W; x++) {
					if (data[row + x * 4 + 3] > 8) {
						if (x < minX) minX = x;
						if (x > maxX) maxX = x;
						if (y < minY) minY = y;
						if (y > maxY) maxY = y;
					}
				}
			}
			if (maxX < 0) return null;
			return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
		}

		// 标注以外的区域在原图和改后图里本应一样：按两边均值逐通道校正改后图的整体色调。
		function toneGains(orig, edit, mask) {
			const sum = [0, 0, 0, 0, 0, 0];
			let n = 0;
			for (let i = 0; i < mask.length; i += 4) {
				if (mask[i + 3] > 0) continue;
				sum[0] += orig[i]; sum[1] += orig[i + 1]; sum[2] += orig[i + 2];
				sum[3] += edit[i]; sum[4] += edit[i + 1]; sum[5] += edit[i + 2];
				n++;
			}
			if (n < 64) return [1, 1, 1];
			const g = [];
			for (let c = 0; c < 3; c++) {
				const a = sum[c] / n, b = sum[c + 3] / n;
				g.push(b < 4 ? 1 : Math.min(1.25, Math.max(0.8, a / b)));
			}
			return g;
		}

		function featherPx(w, h) {
			return Math.min(24, Math.max(2, Math.round(Math.min(w, h) * 0.012)));
		}

		// ---- 页面 ----

		function el(tag, style, text) {
			const e = document.createElement(tag);
			if (style) e.style.cssText = style;
			if (text != null) e.textContent = text;
			return e;
		}

		function button(label, primary) {
			const b = el("button", "font:13px " + FONT + ";padding:7px 14px;border-radius:8px;cursor:pointer;border:1px solid " + (primary ? "#3b82f6" : "rgba(255,255,255,.18)") + ";background:" + (primary ? "#3b82f6" : "rgba(255,255,255,.06)") + ";color:#fff;white-space:nowrap", label);
			b.type = "button";
			return b;
		}

		// 原图路径 -> 保存用的名字：去掉扩展名和生成/修改时留下的时间戳（-2026-10-14T09-45-43、
		// -edit-…），新时间戳由服务端加。
		function stemFromPath(p) {
			const base = String(p || "").split(/[\\/]/).pop() || "image";
			let stem = base.replace(/\.[^.]+$/, "");
			for (let i = 0; i < 4; i++) stem = stem.replace(/(-edit)?-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, "");
			return stem || "image";
		}

		function stemOf(img) {
			let p = img.getAttribute("alt") || "";
			if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(p)) {
				try { p = new URL(img.currentSrc || img.src, location.href).searchParams.get("path") || ""; } catch (e) { p = ""; }
			}
			return stemFromPath(p);
		}

		function canvasOf(w, h) {
			const c = document.createElement("canvas");
			c.width = w;
			c.height = h;
			return c;
		}

		function loadBitmap(src) {
			return fetch(src, { credentials: "same-origin" }).then((r) => {
				if (!r.ok) throw new Error("读不到这张图（" + r.status + "）");
				return r.blob();
			}).then((b) => createImageBitmap(b));
		}

		function postJson(path, body) {
			return fetch(path, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}).then((r) => r.json().catch(() => ({ ok: false, error: "HTTP " + r.status })).then((j) => {
				if (!r.ok || !j || j.ok !== true) throw new Error((j && j.error) || ("HTTP " + r.status));
				return j;
			}));
		}

		// 把结果放进输入框，员工可以接着让 agent 拿它生视频、再改。放不进去也不影响已保存的文件。
		function attachToComposer(blob, name) {
			try {
				const box = document.querySelector('[role="textbox"][contenteditable="true"], textarea[placeholder]');
				if (!box || typeof DataTransfer !== "function") return false;
				const dt = new DataTransfer();
				dt.items.add(new File([blob], name, { type: "image/png" }));
				box.focus();
				const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
				box.dispatchEvent(ev);
				return ev.defaultPrevented;
			} catch (e) {
				return false;
			}
		}

		function openEditor(img) {
			if (document.getElementById("company-region-editor")) return;
			const stem = stemOf(img);
			const root = el("div", "position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,12,.97);display:flex;flex-direction:column;font:13px " + FONT + ";color:#eee");
			root.id = "company-region-editor";
			const head = el("div", "display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.08)");
			head.appendChild(el("div", "font-size:15px;font-weight:600", "局部修改"));
			head.appendChild(el("div", "opacity:.65;flex:1", "在图上涂出要改的地方，再写清楚改成什么。没涂到的地方保持原样。"));
			const close = button("关闭");
			head.appendChild(close);
			const body = el("div", "flex:1;display:flex;min-height:0");
			const stage = el("div", "flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden");
			const side = el("div", "width:300px;flex:none;padding:14px;display:flex;flex-direction:column;gap:12px;border-left:1px solid rgba(255,255,255,.08);overflow:auto");
			body.appendChild(stage);
			body.appendChild(side);
			root.appendChild(head);
			root.appendChild(body);

			const view = canvasOf(10, 10);
			const over = canvasOf(10, 10);
			view.style.cssText = "position:absolute;image-rendering:auto";
			over.style.cssText = "position:absolute;cursor:crosshair;touch-action:none";
			stage.appendChild(view);
			stage.appendChild(over);
			const loading = el("div", "opacity:.7", "正在读取图片…");
			stage.appendChild(loading);

			// 工具
			const tools = el("div", "display:flex;gap:6px;flex-wrap:wrap");
			const tBrush = button("画笔"), tRect = button("框选"), tErase = button("橡皮");
			const tUndo = button("撤销"), tClear = button("清空");
			[tBrush, tRect, tErase, tUndo, tClear].forEach((b) => tools.appendChild(b));
			const sizeRow = el("label", "display:flex;align-items:center;gap:8px");
			sizeRow.appendChild(el("span", "opacity:.75;white-space:nowrap", "笔刷大小"));
			const size = el("input", "flex:1");
			size.type = "range"; size.min = "6"; size.max = "160"; size.value = "40";
			sizeRow.appendChild(size);
			const prompt = el("textarea", "width:100%;box-sizing:border-box;min-height:96px;resize:vertical;font:13px " + FONT + ";color:#eee;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px");
			prompt.placeholder = "改成什么？例如：把这棵树换成开满花的樱花树";
			const go = button("开始修改", true);
			const status = el("div", "min-height:18px;opacity:.85;line-height:1.5;white-space:pre-wrap");
			const after = el("div", "display:none;flex-direction:column;gap:8px");
			const bSave = button("保存并放进输入框", true), bAgain = button("不满意，再改一次"), bMore = button("在结果上继续改"), bBack = button("放弃这次结果");
			const bCompare = button("按住看原图");
			[bSave, bCompare, bAgain, bMore, bBack].forEach((b) => after.appendChild(b));
			side.appendChild(tools);
			side.appendChild(sizeRow);
			side.appendChild(el("div", "opacity:.75", "改成什么"));
			side.appendChild(prompt);
			side.appendChild(go);
			side.appendChild(status);
			side.appendChild(after);
			document.body.appendChild(root);

			let base = null; // 当前底图（canvas，原尺寸，最长边不超过 MAX_SIDE）
			let result = null; // 本次改完的整图
			let W = 0, H = 0, scale = 1;
			let mask = null; // 标注，原尺寸，alpha 表示涂了
			let ops = [];
			let tool = "brush";
			let busy = false;
			let showOrig = false;

			function setTool(t) {
				tool = t;
				[[tBrush, "brush"], [tRect, "rect"], [tErase, "erase"]].forEach((p) => {
					p[0].style.borderColor = p[1] === t ? "#3b82f6" : "rgba(255,255,255,.18)";
				});
			}
			setTool("brush");

			function layout() {
				if (!base) return;
				const sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
				scale = Math.min(sw / W, sh / H, 2);
				const dw = Math.max(1, Math.round(W * scale)), dh = Math.max(1, Math.round(H * scale));
				[view, over].forEach((c) => {
					c.width = dw; c.height = dh;
					c.style.left = Math.round((stage.clientWidth - dw) / 2) + "px";
					c.style.top = Math.round((stage.clientHeight - dh) / 2) + "px";
				});
				paint();
			}

			function paint(preview) {
				if (!base) return;
				const v = view.getContext("2d");
				v.clearRect(0, 0, view.width, view.height);
				v.drawImage(result && !showOrig ? result : base, 0, 0, view.width, view.height);
				const o = over.getContext("2d");
				o.clearRect(0, 0, over.width, over.height);
				if (result) return;
				o.globalCompositeOperation = "source-over";
				o.drawImage(mask, 0, 0, over.width, over.height);
				o.globalCompositeOperation = "source-in";
				o.fillStyle = "rgba(255,48,48,.45)";
				o.fillRect(0, 0, over.width, over.height);
				o.globalCompositeOperation = "source-over";
				if (preview) {
					o.setLineDash([6, 4]);
					o.strokeStyle = "#ff5050";
					o.lineWidth = 2;
					o.strokeRect(preview.x * scale, preview.y * scale, preview.w * scale, preview.h * scale);
					o.setLineDash([]);
				}
			}

			function drawOp(ctx, op) {
				ctx.globalCompositeOperation = op.erase ? "destination-out" : "source-over";
				ctx.fillStyle = "#fff";
				ctx.strokeStyle = "#fff";
				if (op.type === "rect") {
					ctx.fillRect(op.x, op.y, op.w, op.h);
				} else {
					ctx.lineCap = "round";
					ctx.lineJoin = "round";
					ctx.lineWidth = op.size;
					ctx.beginPath();
					ctx.moveTo(op.pts[0][0], op.pts[0][1]);
					for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i][0], op.pts[i][1]);
					if (op.pts.length === 1) ctx.lineTo(op.pts[0][0] + 0.01, op.pts[0][1]);
					ctx.stroke();
				}
				ctx.globalCompositeOperation = "source-over";
			}

			function replay() {
				const m = mask.getContext("2d");
				m.clearRect(0, 0, W, H);
				ops.forEach((op) => drawOp(m, op));
				paint();
			}

			function point(ev) {
				const r = over.getBoundingClientRect();
				return [Math.min(W, Math.max(0, (ev.clientX - r.left) / scale)), Math.min(H, Math.max(0, (ev.clientY - r.top) / scale))];
			}

			let cur = null;
			over.addEventListener("pointerdown", (ev) => {
				if (!base || busy || result) return;
				over.setPointerCapture(ev.pointerId);
				const p = point(ev);
				if (tool === "rect") cur = { type: "rect", x0: p[0], y0: p[1], x: p[0], y: p[1], w: 0, h: 0 };
				else {
					cur = { type: "brush", erase: tool === "erase", size: Number(size.value) / scale, pts: [p] };
					drawOp(mask.getContext("2d"), cur);
					paint();
				}
			});
			over.addEventListener("pointermove", (ev) => {
				if (!cur) return;
				const p = point(ev);
				if (cur.type === "rect") {
					cur.x = Math.min(cur.x0, p[0]); cur.y = Math.min(cur.y0, p[1]);
					cur.w = Math.abs(p[0] - cur.x0); cur.h = Math.abs(p[1] - cur.y0);
					paint(cur);
				} else {
					const m = mask.getContext("2d");
					const last = cur.pts[cur.pts.length - 1];
					cur.pts.push(p);
					drawOp(m, { type: "brush", erase: cur.erase, size: cur.size, pts: [last, p] });
					paint();
				}
			});
			const finish = () => {
				if (!cur) return;
				if (cur.type === "rect") {
					if (cur.w >= 4 && cur.h >= 4) {
						const op = { type: "rect", x: cur.x, y: cur.y, w: cur.w, h: cur.h };
						ops.push(op);
						drawOp(mask.getContext("2d"), op);
					}
					paint();
				} else ops.push(cur);
				cur = null;
			};
			over.addEventListener("pointerup", finish);
			over.addEventListener("pointercancel", finish);

			tBrush.onclick = () => setTool("brush");
			tRect.onclick = () => setTool("rect");
			tErase.onclick = () => setTool("erase");
			tUndo.onclick = () => { if (!busy && !result && ops.length) { ops.pop(); replay(); } };
			tClear.onclick = () => { if (!busy && !result) { ops = []; replay(); } };

			function say(text) { status.textContent = text; }

			function setBusy(on) {
				busy = on;
				[go, tBrush, tRect, tErase, tUndo, tClear, bSave, bAgain, bMore, bBack].forEach((b) => { b.disabled = on; b.style.opacity = on ? ".5" : "1"; });
			}

			function showAfter(on) {
				after.style.display = on ? "flex" : "none";
				go.style.display = on ? "none" : "";
				over.style.cursor = on ? "default" : "crosshair";
			}

			async function runEdit() {
				const text = prompt.value.trim();
				if (!text) { say("先写上要改成什么。"); prompt.focus(); return; }
				const md = mask.getContext("2d").getImageData(0, 0, W, H).data;
				const bbox = alphaBox(md, W, H);
				if (!bbox) { say("先在图上涂出要改的地方（画笔或框选）。"); return; }
				const box = cropBox(bbox, W, H);
				setBusy(true);
				const t0 = Date.now();
				const tick = setInterval(() => say("正在修改…已用 " + Math.round((Date.now() - t0) / 1000) + " 秒（一般 20–60 秒）"), 1000);
				try {
					// 裁片：最长边超过 SEND_SIDE 就缩，比例不变；JPEG 送（PNG 大几倍，员工在外走中转时会超时）。
					const k = Math.min(1, SEND_SIDE / Math.max(box.pw, box.ph));
					const sendC = canvasOf(Math.round(box.pw * k), Math.round(box.ph * k));
					const sx = sendC.getContext("2d");
					// 补边（只在图里放不下标准比例时有）：先把裁片拉满整块当底，再把裁片原样放在中间。
					if (box.pw !== box.w || box.ph !== box.h) sx.drawImage(base, box.x, box.y, box.w, box.h, 0, 0, sendC.width, sendC.height);
					sx.drawImage(base, box.x, box.y, box.w, box.h, box.ox * k, box.oy * k, box.w * k, box.h * k);
					const out = await postJson("/company/media/region-edit", {
						prompt: text,
						image: sendC.toDataURL("image/jpeg", 0.92),
						aspect_ratio: box.ratio,
						resolution: Math.max(sendC.width, sendC.height) > 1500 ? "2k" : "1k",
					});
					const bmp = await loadBitmap("data:" + out.mime + ";base64," + out.b64);
					// 改后的图缩回送出时的大小（比例相同，不变形），切掉补边，留下裁片那块。
					const editC = canvasOf(box.w, box.h);
					const ec = editC.getContext("2d");
					ec.drawImage(bmp, -box.ox, -box.oy, box.pw, box.ph);
					const origC = canvasOf(box.w, box.h);
					origC.getContext("2d").drawImage(base, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
					const maskC = canvasOf(box.w, box.h);
					maskC.getContext("2d").drawImage(mask, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
					// 色调校正
					const ed = ec.getImageData(0, 0, box.w, box.h);
					const g = toneGains(origC.getContext("2d").getImageData(0, 0, box.w, box.h).data, ed.data, maskC.getContext("2d").getImageData(0, 0, box.w, box.h).data);
					if (g[0] !== 1 || g[1] !== 1 || g[2] !== 1) {
						for (let i = 0; i < ed.data.length; i += 4) {
							ed.data[i] = Math.min(255, ed.data[i] * g[0]);
							ed.data[i + 1] = Math.min(255, ed.data[i + 1] * g[1]);
							ed.data[i + 2] = Math.min(255, ed.data[i + 2] * g[2]);
						}
						ec.putImageData(ed, 0, 0);
					}
					// 羽化蒙版：标注边缘向外几像素渐变，再往外完全是原图。
					const f = featherPx(box.w, box.h);
					const soft = canvasOf(box.w, box.h);
					const sc = soft.getContext("2d");
					sc.filter = "blur(" + f + "px)";
					sc.drawImage(maskC, 0, 0);
					sc.filter = "none";
					sc.drawImage(maskC, 0, 0); // 标注内部保持完全不透明
					ec.globalCompositeOperation = "destination-in";
					ec.drawImage(soft, 0, 0);
					ec.globalCompositeOperation = "source-over";
					result = canvasOf(W, H);
					const rc = result.getContext("2d");
					rc.drawImage(base, 0, 0);
					rc.drawImage(editC, box.x, box.y);
					showAfter(true);
					paint();
					say("改好了，用时 " + Math.round((Date.now() - t0) / 1000) + " 秒。按住「按住看原图」对比。");
				} catch (e) {
					say("没改成：" + ((e && e.message) || e));
				} finally {
					clearInterval(tick);
					setBusy(false);
				}
			}

			go.onclick = () => { if (!busy) runEdit(); };
			bAgain.onclick = () => { if (busy) return; result = null; showAfter(false); paint(); runEdit(); };
			bBack.onclick = () => { if (busy) return; result = null; showAfter(false); paint(); say(""); };
			bMore.onclick = () => {
				if (busy || !result) return;
				base = result; result = null; ops = []; replay(); showAfter(false);
				say("已把结果当成新的底图，接着涂下一处。");
			};
			const press = (on) => () => { if (result) { showOrig = on; paint(); } };
			bCompare.addEventListener("pointerdown", press(true));
			bCompare.addEventListener("pointerup", press(false));
			bCompare.addEventListener("pointerleave", press(false));
			bSave.onclick = async () => {
				if (busy || !result) return;
				setBusy(true);
				say("正在保存…");
				try {
					const url = result.toDataURL("image/png");
					const out = await postJson("/company/media/region-save", { image: url, name: stem });
					const blob = await (await fetch(url)).blob();
					const name = String(out.path).split(/[\\/]/).pop();
					const put = attachToComposer(blob, name);
					say("已保存：" + out.path + (put ? "\n已放进输入框，可以接着让它生视频或再改。" : "\n可以在输入框里 @ 这个文件继续用。"));
					if (put) setTimeout(shut, 900);
				} catch (e) {
					say("保存失败：" + ((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			};

			function shut() {
				window.removeEventListener("resize", layout);
				window.removeEventListener("keydown", onKey, true);
				root.remove();
			}
			function onKey(ev) {
				if (ev.key === "Escape" && !busy) { ev.stopPropagation(); shut(); }
				else if ((ev.ctrlKey || ev.metaKey) && ev.key === "z" && document.activeElement !== prompt) { ev.preventDefault(); tUndo.onclick(); }
			}
			close.onclick = () => { if (!busy) shut(); };
			window.addEventListener("resize", layout);
			window.addEventListener("keydown", onKey, true);

			loadBitmap(img.currentSrc || img.src).then((bmp) => {
				const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
				W = Math.round(bmp.width * k); H = Math.round(bmp.height * k);
				base = canvasOf(W, H);
				base.getContext("2d").drawImage(bmp, 0, 0, W, H);
				mask = canvasOf(W, H);
				loading.remove();
				layout();
				prompt.focus();
			}, (e) => { loading.textContent = "打不开这张图：" + ((e && e.message) || e); });
		}

		// 悬停按钮：一个浮动按钮，跟着鼠标下的图片走。
		function eligible(img) {
			if (!img || img.tagName !== "IMG" || img.closest("#company-region-editor")) return false;
			if (img.naturalWidth < MIN_IMG || img.naturalHeight < MIN_IMG) return false;
			const r = img.getBoundingClientRect();
			if (r.width < 120 || r.height < 90) return false;
			const src = img.currentSrc || img.src || "";
			if (src.indexOf("data:image/") === 0 || src.indexOf("blob:") === 0) return true;
			try { return new URL(src, location.href).origin === location.origin; } catch (e) { return false; }
		}

		function plantHover() {
			if (typeof document === "undefined" || document.getElementById("company-region-hover")) return () => {};
			const b = button("局部修改", true);
			b.id = "company-region-hover";
			b.title = "在图上涂出要改的地方，只改那一块";
			b.style.position = "fixed";
			b.style.zIndex = "2147482000";
			b.style.display = "none";
			b.style.padding = "4px 10px";
			b.style.fontSize = "12px";
			b.style.boxShadow = "0 2px 8px rgba(0,0,0,.35)";
			document.body.appendChild(b);
			let target = null;
			let hideT = 0;
			const place = (img) => {
				const r = img.getBoundingClientRect();
				b.style.left = Math.round(r.right - b.offsetWidth - 8) + "px";
				b.style.top = Math.round(r.top + 8) + "px";
			};
			const onOver = (ev) => {
				const img = ev.target && ev.target.closest ? ev.target.closest("img") : null;
				if (ev.target === b) { clearTimeout(hideT); return; }
				if (!eligible(img)) return;
				clearTimeout(hideT);
				target = img;
				b.style.display = "block";
				place(img);
			};
			const onOut = (ev) => {
				if (ev.target !== target && ev.target !== b) return;
				clearTimeout(hideT);
				hideT = setTimeout(() => { b.style.display = "none"; target = null; }, 250);
			};
			const onScroll = () => { if (target && b.style.display === "block") place(target); };
			b.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				const img = target;
				b.style.display = "none";
				if (img) openEditor(img);
			});
			document.addEventListener("mouseover", onOver, true);
			document.addEventListener("mouseout", onOut, true);
			window.addEventListener("scroll", onScroll, true);
			return () => {
				document.removeEventListener("mouseover", onOver, true);
				document.removeEventListener("mouseout", onOut, true);
				window.removeEventListener("scroll", onScroll, true);
				b.remove();
			};
		}

		function apply(ctx) {
			if (typeof document === "undefined") return;
			if (ctx && typeof ctx.effect === "function") ctx.effect(() => plantHover());
			else plantHover();
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.__test = { cropBox, alphaBox, toneGains, featherPx, stemFromPath, RATIOS };
		return module.exports;
	}
});
