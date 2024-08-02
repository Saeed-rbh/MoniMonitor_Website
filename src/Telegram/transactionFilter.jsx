import React from "react";
import { useSprings, animated } from "react-spring";
import { ScalableElement } from "./tools";
import { CiSearch, CiCalendarDate } from "react-icons/ci";

const TransactionFilter = ({
  sortby,
  setSortby,
  setIsCalendarClicked,
  isCalendarClicked,
}) => {
  const sortItems = ["All", "Daily", "Monthly"];

  const [springs] = useSprings(
    sortItems.length,
    (index) => ({
      filter: sortby === sortItems[index] ? "grayscale(0)" : "grayscale(1)",
      color: sortby === sortItems[index] ? "var(--Bc-1)" : "var(--Ac-1)",
      fontWeight: sortby === sortItems[index] ? "600" : "200",
      outline:
        sortby === sortItems[index]
          ? "1px solid var(--Bc-2)"
          : "1px solid var(--Bc-2)",
    }),
    [sortby]
  );

  return (
    <animated.div className="TransactionList_Menu">
      <p>
        <h3>Filter</h3> Transactions
      </p>
      {springs.map((props, index) => (
        <ScalableElement
          as="h1"
          key={sortItems[index]}
          style={{ ...props }}
          onClick={() => setSortby(sortItems[index])}
        >
          {sortItems[index]}
        </ScalableElement>
      ))}
      <ScalableElement as="h2">
        <CiSearch />
      </ScalableElement>
      <ScalableElement
        as="h2"
        onClick={() => setIsCalendarClicked(!isCalendarClicked)}
      >
        <CiCalendarDate />
      </ScalableElement>
      <p></p>
    </animated.div>
  );
};

export default TransactionFilter;
