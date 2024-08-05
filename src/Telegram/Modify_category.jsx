import React from "react";
import { useSpring, animated } from "@react-spring/web";
import { LiaHouseDamageSolid } from "react-icons/lia";
import { LiaBusSolid } from "react-icons/lia";
import { MdOutlineLocalGroceryStore } from "react-icons/md";
import { RiMentalHealthLine } from "react-icons/ri";
import { BiBookBookmark } from "react-icons/bi";
import { CgGym } from "react-icons/cg";
import { MdOutlineQuestionMark } from "react-icons/md";
import { IoClose } from "react-icons/io5";

function ModifyCategory({
  categoryClick,
  halfHeightS,
  halfHeightE,
  setCategoryClick,
}) {
  const Expense_categories = [
    ["Utilities", <LiaHouseDamageSolid />],
    ["Transportation", <LiaBusSolid />],
    ["Groceries & Dining", <MdOutlineLocalGroceryStore />],
    ["Health", <RiMentalHealthLine />],
    ["Education ", <BiBookBookmark />],
    ["Leisure", <CgGym />],
    ["Other", <MdOutlineQuestionMark />],
  ];

  const ClickOpacityStyle = useSpring({
    from: {
      opacity: !categoryClick ? 0.5 : 1,
      scale: !categoryClick ? 0.9 : 1,
      filter: !categoryClick ? "blur(0px)" : "blur(10px)",
    },
    to: {
      opacity: !categoryClick ? 0.5 : 1,
      scale: !categoryClick ? 0.9 : 1,
      filter: !categoryClick ? "blur(10px)" : "blur(0px)",
    },
  });
  const ClickModifyStyle = useSpring({
    from: {
      opacity: categoryClick ? "0" : "1",
      top: categoryClick ? halfHeightS + 80 : halfHeightE + 80,
      scale: 1.1,
    },
    to: {
      opacity: categoryClick ? "1" : "0",
      top: !categoryClick ? halfHeightS + 80 : halfHeightE + 80,
      scale: 1.1,
    },
  });
  const ClickCloseStyle = useSpring({
    from: {
      opacity: categoryClick ? "0" : "1",
      top: !categoryClick ? halfHeightS : halfHeightE,
      zIndex: 100,
    },
    to: {
      opacity: categoryClick ? "1" : "0",
      top: categoryClick ? halfHeightS : halfHeightE,
      zIndex: 100,
    },
  });
  return (
    <animated.div className="TransactionModification" style={ClickOpacityStyle}>
      <animated.div
        className="TransactionModification_Close"
        style={ClickCloseStyle}
        onClick={() => setCategoryClick(false)}
      >
        <IoClose />
      </animated.div>
      <animated.div
        className="TransactionModification_Modify"
        style={ClickModifyStyle}
      >
        <div className="TransactionModification_Category">
          {Expense_categories.map((category, index) => (
            <p>
              {category[1]}
              <h3>{category[0]}</h3>
            </p>
          ))}
        </div>
      </animated.div>
    </animated.div>
  );
}

export default ModifyCategory;
