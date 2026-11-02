import { describe, expect, it } from "vitest";
import { getTransactionDisplayReason } from "./transactionDisplay";

describe("getTransactionDisplayReason", () => {
  it("removes a duplicated label from the start of a reason", () => {
    expect(getTransactionDisplayReason("Dining - Tim Hortons", "Dining")).toBe(
      "Tim Hortons"
    );
  });

  it("keeps a reason that does not repeat the label", () => {
    expect(
      getTransactionDisplayReason("Payment or purchase - Bosphorus", "Dining")
    ).toBe("Payment or purchase - Bosphorus");
  });

  it("handles a missing reason", () => {
    expect(getTransactionDisplayReason(null, "Dining")).toBe(
      "No reason provided"
    );
  });
});

it('uses just the same full counterparty name across bank and AI e-transfer wording',()=>{
 for(const reason of ["E-Transfer - MARA TAYLOR","MARA TAYLOR - INTERAC e-Transfer®","Interac e-Transfer received from Mara Taylor","E-TRANSFER SENT MARA TAYLOR 9Z4X2Q"]){
  expect(getTransactionDisplayReason(reason,'Personal Transfers')).toBe('Mara Taylor');
 }
 expect(getTransactionDisplayReason('E-TRANSFER SENT JORDAN WINTERS','Personal Transfers')).toBe('Jordan Winters');
 expect(getTransactionDisplayReason('E-Transfer', 'Personal Transfers',{CounterpartyName:"Élodie D’Angelo"})).toBe("Élodie D’Angelo");
 expect(getTransactionDisplayReason('E-Transfer','Personal Transfers')).toBe('E-Transfer');
});

it('extracts names from native bank reference and autodeposit formats',()=>{
 for(const reason of ['Internet Banking E-TRANSFER 011827773561 MARA TAYLOR','E-TRANSFER - AUTODEPOSIT MARA TAYLOR C1AKFKNECQJU','E-TRANSFER CANCEL MARA TAYLOR PUTV7G']){
  expect(getTransactionDisplayReason(reason,'Personal Transfers')).toBe('Mara Taylor');
 }
 expect(getTransactionDisplayReason('E-TRANSFER - AUTODEPOSIT ACME CONSTRUCTION INC. A07F3B19B2484F4B9DD3EB0939CB0157','Personal Transfers Received')).toBe('Acme Construction Inc.');
});

it('preserves the descriptions of debit purchases, fees and other transfer rails',()=>{
 for(const reason of ['Point of Sale - Interac RETAIL PURCHASE 618001001114 ULTRAMAR # 2635','CONTACTLESS INTERAC TRANSIT - 5875 PRES/5D65PMMD8J','INTERAC E-TRANSFER RECLAIM FEE','EXPIRED INTERAC E-TRANSFER CREDIT','MISC PAYMENT PAYPAL','MISC PAYMENT WISE','DEPOSIT ONLINE TRANSFER','ONLINE BANKING TRANSFER - 7334','Money transfer into the account (executed at 2026-08-29)','Transfer in','Transfer out','Internal transfer: Example Chequing -> Example Card']){
  expect(getTransactionDisplayReason(reason,'Personal Transfers',{Type:'e-Transfer',CounterpartyName:'Old Incorrect Name'})).toBe(reason);
 }
});
