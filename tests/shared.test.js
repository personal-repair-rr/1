import test from 'node:test';import assert from 'node:assert/strict';
import {makePublic,escapeSheetFormula,isSafeText,headers} from '../shared.js';
test('public ticket excludes phone and internal note',()=>{const t=makePublic({id:'A',phone:'123',adminNote:'private',reporter:'Teacher',row:2});assert.equal(t.phone,undefined);assert.equal(t.adminNote,undefined);assert.equal(t.row,undefined);assert.equal(t.reporter,'Teacher')});
test('escape sheet formula injection',()=>{assert.equal(escapeSheetFormula('=IMPORTXML("x")'),"'=IMPORTXML(\"x\")");assert.equal(escapeSheetFormula('Normal'),'Normal')});
test('valid text',()=>{assert.equal(isSafeText('Hello',100),true);assert.equal(isSafeText('',100),false);assert.equal(headers.length,15)});
