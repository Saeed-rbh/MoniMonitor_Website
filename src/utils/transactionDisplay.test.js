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
