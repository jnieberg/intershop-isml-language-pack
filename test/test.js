const express = require('express');
const http = require('http');
const fs = require('fs'); // file system manager

const app = express();

let variables = [];
let counters = {};

function addVar(variable) {
	if (variable !== '' && variable.replace(/^([a-zA-Z][a-zA-Z0-9]*).*?$/g, '$1') === variable && variables.indexOf(variable) === -1) {
		variables.push(variable);
	}
}

function backupText(rows, num, rx) {
	const rowsNew = [];
	const result = [];
	let index = 0;
	for (let r = 0; r < rows.length; r++) {
		const row = rows[r];
		if (typeof row[1] !== 'undefined') {
			result.push(...(row[1].match(rx) || []));
			rowsNew.push([row[0], row[1].replace(rx, res => {
				return `_xx_${num}_${index++}_xx_`;
			})]);
		}
	}
	return [rowsNew, result];
}

function restoreText(rows, num, arr) {
	const rowsNew = [];
	for (let r = 0; r < rows.length; r++) {
		let row = rows[r];
		if (row) {
			const restoreRx = new RegExp(`_xx_${num}_(\\d+)_xx_`, 'g');
			row = row.replace(restoreRx, (res, a1) => {
				return !isNaN(Number(a1)) && arr[Number(a1)];
			});
			rowsNew.push(row);
		}
	}
	return rowsNew;
}

function parseArguments(args) {
	return args.replace(/\b([a-zA-Z][a-zA-Z0-9]*)\b(?!\:)/gim, '$1()'); // '_var($1)'
}

function evaluateRow(row, { inline = false } = {}) {
	let rowS = '';
	const varRx = /^(\s*[^;\s]+?)(;|\s|\?|>|\+|-|=|$)(.*?)$/;
	const initiator = row[0];
	const variable = row[1].replace(varRx, '$1'); // /^(\s*[^;\s]+?)(?:;|\s|$)(.*?)$/
	const modifier = row[1].replace(varRx, '$2');
	const argument = row[1].replace(varRx, '$3');
	console.log(222, [initiator, variable, modifier, argument]);
	const variableP = variable.replace(/\.(.+?)/g, '[$1]');
	const argumentP = parseArguments(argument).replace(/\s+/g, ',');
	if (initiator === '\\') {
		rowS = `//${row[1]}`;
	} else if (initiator === '=') {
		if (!inline) {
			addVar(variable);
		}
		rowS = `${inline ? variable + ':' : '_' + variableP + '=' + variableP + '()\n' + variableP + '=function(_index=0){return '}`;
		// if (argument === '') {
		// } else
		if (argument.indexOf(';') === 0) {
			const arg = argument.substring(1).split(/;/g);
			const rowA = [];
			for (let a = 0; a < arg.length; a++) {
				rowA.push(evaluateRow(['=', arg[a]], { inline: true }));
			}
			let rowAS = rowA.join(';');
			rowAS = rowAS
				.replace(/;(\s*)\s([^\s].+?);\1(?!\s)/g, ';$1 $2};$1')
				.replace(/;(\s+)([^\s].+?);\1\s/g, ';$1$2;{$1 ')
				.replace(/:'';/g, ':');
			const brack = rowAS.split(/{/g).length - rowAS.split(/}/g).length; // fill in any missing closing brackets
			if (modifier === '+') {
				rowS = `${rowS}_${variableP}.concat([{${rowAS}${Array(brack + 1).join('}')}}]).flat().filter(v=>typeof v!=='undefined'&&v!=='')`;
			} else {
				rowS = `${rowS}[{${rowAS}${Array(brack + 1).join('}')}}]`;
			}
		} else if (modifier === ' ') {
			rowS = `${rowS}[${argumentP}].flat()`;
		} else if (modifier === '?') {
			rowS = `${rowS}[${argumentP}].flat()[Math.floor(Math.random()*[${argumentP}].flat().length)]`;
		} else if (modifier === '>') {
			let mm = argumentP.split(/,/g);
			mm = mm.length === 1 ? [0, mm[0]] : !mm.length ? [0, 1] : [mm[0], mm[1]];
			rowS = `${rowS}Math.floor(Math.random()*(${mm[1]}-${mm[0]}+1))+${mm[0]}`;
		} else if (modifier === '+') {
			if (argumentP) {
				rowS = `${rowS}_${variableP}.map((v,i)=>(v||'')+[${argumentP}].flat()[(i+_index)%[${argumentP}].flat().length])`;
			} else {
				rowS = `${rowS}_${variableP}=[${argumentP || ('_' + variableP)}].flat().map(v=>typeof v==='number'?v+1:0)`;
			}
		} else if (modifier === '-') {
			if (argumentP) {
				rowS = `${rowS}_${variableP}.map((v,i)=>(v||'')-[${argumentP}].flat()[(i+_index)%[${argumentP}].flat().length])`;
			} else {
				rowS = `${rowS}_${variableP}=[${argumentP || ('_' + variableP)}].flat().map(v=>typeof v==='number'?v-1:0)`;
			}
		} else {
			rowS = `${rowS}${argumentP || '\'\''}`;
		}
		rowS = `${rowS}${inline ? '' : '}'}`;
	} else if (initiator === '?') {
		const modList = {
			'=': '===',
			'>': '>',
			'<': '<'
		};
		const mod = modList[modifier];
		const arg = argument.split(/;/g);
		rowS = `${rowS}if(${variableP}()${mod}[${arg[0].replace(/\s/g, ',')}].flat()) {`;
		for (let a = 1; a < arg.length; a++) {
			rowS = `${rowS}${evaluateRow([arg[a].substring(0, 1), arg[a].substring(1)], { inline: true })}\n`;
		}
		rowS = `${rowS}}`;
	} else if (initiator === '!') {
		let vars = row[1]
			.split(' ')
			.map(r => {
				const isVar = r.search(/^[a-z]/i) === 0;
				if (isVar) {
					const r2 = r.replace(/\.(.+?)(?=\.|$)/g, (res, a1) => {
						const a = isNaN(Number(a1)) ? `'${a1}'` : Number(a1);
						return `()[${a}]`;
					});
					addVar(r2);
					counters[r2] = counters[r2] || 0;
					return `_var(${r2},${counters[r2]++})`;
				}
				return `_var(${r})`;
			})
			.join('+\' \'+');
		vars = vars || '[\'\']';
		rowS = `_out+='<div class="row">'+${vars}+'</div>'`;
	}
	rowS = rowS.replace(/;/g, ',');
	return rowS + (inline ? '' : ';');
}

app.get('/:file', (request, response) => {
	const file = request.params.file;
	variables = [];
	counters = {};
	fs.readFile(`./files/${file}.crip`, (error, html) => {
		if (error) {
			response.end(`<p style="color:red;">ERROR: ${error}</p>`);
		}
		if (html) {
			let quotes = null;
			console.log(html.toString());
			const rows = html
				.toString()
				.replace(/^(\?.*?)\n([\w\W]*?)\n\n/gm, (res, a1, a2) => `${a1};${a2.replace(/\n/g, ';')}\n\n`) // if
				.replace(/\n(?!\s)/g, '\n\n')
				.replace(/\n\n\n/g, '\n\n')
				.split(/\n\n/g)
				.map(r => [
					r.substring(0, 1), r.substring(1).replace(/\n/g, ';').replace(/^(\w*?);/, '$1;;')
				]);
			let rowsNew = [];
			let output = '';
			rowsNew = rows;
			[rowsNew, quotes] = backupText(rowsNew, 1, /'.*?'/gm);
			for (let r = 0; r < rowsNew.length; r++) {
				rowsNew[r] = evaluateRow(rowsNew[r]);
			}
			rowsNew = restoreText(rowsNew, 1, quotes);
			output = `/*
${html}
*/

var _out = '';
function _var(oA, oC) {
	try {
		let o = oA;
		if(typeof o === 'function') {
			o = oA(oC);
		}
		if(typeof o === 'object') {
			oA = o.length ? o.flat() : [o].flat();
			let result = '';
			for(let i = 0; i < oA.length; i++) {
				if(typeof oA[i] === 'object') {
					oA[i] = JSON.stringify(oA[i], undefined, 2);
					while(oA[i].indexOf('[') > -1) {
						oA[i] = oA[i].replace(/\\[([^\\[\\]]*?)\\]/, (res, a1) => {
							a1 = a1.replace(/\\n\\s*/g, ' ');
							return a1;
						});
					}
					oA[i] = oA[i]
						.replace(/^(\\s*)"(.*?)":/gm, '$1$2')
						.replace(/\\s*[{}\\[\\]]\\n*/g, '\\n')
						.replace(/,/gm, '').replace(/^\\n|\\n$/g, '')
						.replace(/"/g, '\\'').replace(/\\n+/g, '<br>')
						.replace(/^\\s\\s/gm, '')
						.replace(/\\s\\s/gm, '&nbsp;');
				}
				result = result + '<span>' + oA[i] + '</span>';
			}
			return result;
		}
		return typeof o !== 'undefined' && o !== null ? '<span>' + o + '</span>' : '';
	} catch(err) {}
	return '';
}
${variables.map(v => `var ${v}=function(){return ['']}, _${v}=${v}();`).join('\n')}
${rowsNew.join('\n')}
document.querySelector('.content').innerHTML = _out;`;
			response.writeHead(200, {
				'Content-Type': 'text/html; charset=utf-8'
			});
			response.end(`<!DOCTYPE html>
<html lang="en">
<head>
<title>Cripple - ${file}</title>
<style>
body {
	font-size: 12px;
	font-family: consolas;
}
.row {
	display: flex;
	justify-content: flex-start;
	min-height: 30px;
}
.row span {
	background-color: #f0f0f0;
	padding: 8px;
	margin: 4px;
}
</style>
</head>
<body>
<div class="content"></div>
<script>
${output}
</script>
</body>
</html>`);
		}
	});
});

const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT || 8080, () => console.log(`App started. Go to http://localhost:${process.env.PORT || 8080}`));
