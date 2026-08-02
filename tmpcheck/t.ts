import { buildSplRoundtripWorkbook } from "../src/lib/spl/roundtrip-export";
import { buildWrtRoundtripWorkbook } from "../src/lib/wrt/roundtrip-export";
import XLSX from "xlsx-js-style";
const splCat=[
 {stage_code:"RD1",label:"Doc A",band:"REQUIRED_DOC",value_type:"flag",actual_authority:"HDEC",sort_order:1},
 {stage_code:"APPROVAL_DATE",label:"Approval Date",band:"DOCUMENTATION",value_type:"single",actual_authority:"ACONEX",sort_order:10},
 {stage_code:"RFQ_DRAFT",label:"RFQ Draft",band:"PO",value_type:"range",actual_authority:"HDEC",sort_order:20},
] as any;
const items=[{id:"1",plot:"C",spl_number:"SPL-001",title:"A very long document title for width check",dis:"MEC",service:"HVAC",team:"T1",pic:"P",eng:"E",supplier:"S",approval_status_raw:"A",pic_po:"x",eng_po:"y"}];
const wb=buildSplRoundtripWorkbook({catalog:splCat,items,progress:[{item_id:"1",stage_code:"APPROVAL_DATE",actual_start:"2026-01-02"}]});
const ws=wb.Sheets["SPL Plot 3"];
console.log("merges",JSON.stringify(ws["!merges"]));
console.log("cols",JSON.stringify(ws["!cols"]));
console.log("A1",JSON.stringify(ws["A1"]));
console.log("A2",JSON.stringify(ws["A2"]?.s?.fill));
console.log("row3",[0,1,8,9].map(c=>ws[XLSX.utils.encode_cell({r:2,c})]?.v));
console.log("data",[0,1,2].map(c=>ws[XLSX.utils.encode_cell({r:4,c})]?.v));
const wrtCat=[
 {stage_code:"REQ_SUBMISSION",label:"Req Submission",band:"COMMERCIAL",value_type:"range",actual_authority:"HDEC",round_no:null,sort_order:10},
 {stage_code:"RESPONSE_DATE_R1",label:"Response Date",band:"DRAFT_APPROVAL",value_type:"single",actual_authority:"ACONEX",round_no:1,sort_order:70},
 {stage_code:"DOC_PREPARATION",label:"Doc Preparation",band:"SUBMISSION",value_type:"range",actual_authority:"HDEC",round_no:null,sort_order:110},
] as any;
const w2=buildWrtRoundtripWorkbook({catalog:wrtCat,items:[{id:"1",plot:"C",wrt_number:"W-1",title:"t"}],progress:[]});
const s2=w2.Sheets["WRT Plot 3"];
console.log("wrt merges",JSON.stringify(s2["!merges"]));
console.log("wrt band row",[...Array(14).keys()].map(c=>s2[XLSX.utils.encode_cell({r:1,c})]?.v??"."));
