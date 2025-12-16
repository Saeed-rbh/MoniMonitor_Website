import { MdOutlineSsidChart } from "react-icons/md";
import { TbHomeDollar } from "react-icons/tb";
import { BiQuestionMark } from "react-icons/bi";
import { LiaPiggyBankSolid } from "react-icons/lia";
import { TbHomeBolt } from "react-icons/tb";
import { RiSubwayLine } from "react-icons/ri";
import { MdOutlineLocalGroceryStore } from "react-icons/md";
import { PiPillBold } from "react-icons/pi";
import { MdOutlineSchool } from "react-icons/md";
import { BiDrink } from "react-icons/bi";
import { MdAssuredWorkload } from "react-icons/md";
import { MdOutlineWorkOutline } from "react-icons/md";
import { TbMoneybag } from "react-icons/tb";
import { PiHandCoinsDuotone } from "react-icons/pi";
import { BiLogoBitcoin } from "react-icons/bi";

export const Expense_categories = [
  ["Housing & Utilities", <TbHomeBolt />],

  ["Groceries & Dining", <MdOutlineLocalGroceryStore />],
  ["Medical & Health", <PiPillBold />],
  ["Education & Training", <MdOutlineSchool />],
  ["Leisure & Recreation", <BiDrink />],
  ["Transportation", <RiSubwayLine />],
  ["Other", <BiQuestionMark />],
];

export const Income_categories = [
  ["Employment Income", <MdOutlineWorkOutline />],
  ["Employee Benefits", <PiHandCoinsDuotone />],
  ["Government Benefits", <MdAssuredWorkload />],
  ["Investment Income", <TbMoneybag />],
  ["Other", <BiQuestionMark />],
];

export const SaveInvest_categories = [
  ["Savings Account", <LiaPiggyBankSolid />],
  ["Stocks", <MdOutlineSsidChart />],
  ["Cryptocurrency", <BiLogoBitcoin />],
  ["Real Estate", <TbHomeDollar />],
  ["Other", <BiQuestionMark />],
];

export const getTransactionIcon = (category, label) => {
  const OriginalList =
    category === "Income"
      ? Income_categories
      : category === "Expense"
        ? Expense_categories
        : SaveInvest_categories;

  const foundIcon = OriginalList.find(
    (icon) => icon[0].toLowerCase() === label.toLowerCase()
  );

  return foundIcon ? foundIcon[1] : null;
};
