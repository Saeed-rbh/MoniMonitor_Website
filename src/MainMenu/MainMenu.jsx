import React from "react";
import { animated } from "react-spring";
import { TbHomeStats } from "react-icons/tb";
import { HiOutlinePlusSm } from "react-icons/hi";
import { LuLayoutList } from "react-icons/lu";
import { IoWalletOutline } from "react-icons/io5";
import { RiDonutChartFill } from "react-icons/ri";

const MainMenu = () => {
  const [Active, setActive] = React.useState("Summary");
  const MainMenuStyle = {
    position: "fixed",
    width: "385px",
    height: "60px",
    background: "linear-gradient(165deg, var(--Ec-4) -50%, var(--Ac-4) 130%)",
    zIndex: 100,
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    flexDirection: "row",
    color: "var(--Ac-2)",
    fontSize: "0.6rem",
    borderRadius: "25px",
    bottom: "15px",
    flex: "1",
    padding: "15px",
    boxSizing: "border-box",
    border: "2px solid var(--Ac-4)",
    transition: "all 0.5s ease",
  };
  const MainMenuPStyle = {
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    flexDirection: "column",
    color: "var(--Ac-1)",
    fontSize: "0.6rem",
    borderRadius: "10px",
    bottom: "10px",
    cursor: "pointer",
    // width: "20%",
    opacity: 0.7,
    transition: "all 0.3s ease",
  };
  const MainMenuSVGStyle = {
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    flexDirection: "column",
    color: "var(--Bc-1)",
    fontSize: "0.9rem",
    borderRadius: "14px",
    padding: "2px",
    transition: "all 0.3s ease",
  };
  const handleClick = (e) => {
    setActive(e);
  };
  return (
    <animated.div style={MainMenuStyle}>
      <animated.p
        style={{ ...MainMenuPStyle, opacity: Active == "Summary" ? 1 : 0.6 }}
        onClick={() => handleClick("Summary")}
      >
        <div
          style={{
            ...MainMenuSVGStyle,
            background: Active == "Summary" ? "var(--Bc-4)" : "var(--Ec-4)",
            padding: Active == "Summary" ? 8 : 3,
          }}
        >
          <TbHomeStats />
        </div>
        <span>Summary</span>
      </animated.p>
      <p
        style={{ ...MainMenuPStyle, opacity: Active == "Insight" ? 1 : 0.6 }}
        onClick={() => handleClick("Insight")}
      >
        <div
          style={{
            ...MainMenuSVGStyle,
            background: Active == "Insight" ? "var(--Bc-4)" : "var(--Ec-4)",
            padding: Active == "Insight" ? 8 : 3,
          }}
        >
          <RiDonutChartFill />
        </div>
        <span>Insight</span>
      </p>
      <p style={{ ...MainMenuPStyle }} onClick={() => handleClick("Add")}>
        <div
          style={{
            ...MainMenuSVGStyle,
            fontSize: "1.5rem",
            padding: "10px",
            background:
              "linear-gradient(165deg, var(--Bc-3) -50%, var(--Ec-1) 130%)",
            borderRadius: "18px",
          }}
        >
          <HiOutlinePlusSm />
        </div>
      </p>
      <p
        style={{
          ...MainMenuPStyle,
          opacity: Active == "Transactions" ? 1 : 0.6,
        }}
        onClick={() => handleClick("Transactions")}
      >
        <div
          style={{
            ...MainMenuSVGStyle,
            background:
              Active == "Transactions" ? "var(--Bc-4)" : "var(--Ec-4)",
            padding: Active == "Transactions" ? 8 : 3,
          }}
        >
          <LuLayoutList />
        </div>
        <span>Transactions</span>
      </p>
      <p
        style={{ ...MainMenuPStyle, opacity: Active == "Acount" ? 1 : 0.6 }}
        onClick={() => handleClick("Acount")}
      >
        <div
          style={{
            ...MainMenuSVGStyle,
            background: Active == "Acount" ? "var(--Bc-4)" : "var(--Ec-4)",
            padding: Active == "Acount" ? 8 : 3,
          }}
        >
          <IoWalletOutline />
        </div>
        <span>Acount</span>
      </p>
    </animated.div>
  );
};

export default MainMenu;
