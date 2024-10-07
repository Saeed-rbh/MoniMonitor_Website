import React from "react";
import { useSpring, animated } from "react-spring";
import { TbHomeStats } from "react-icons/tb";
import { HiOutlinePlusSm } from "react-icons/hi";
import { LuLayoutList } from "react-icons/lu";
import { IoWalletOutline } from "react-icons/io5";
import { RiDonutChartFill } from "react-icons/ri";
import { ScalableElement } from "../Tools/tools";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import ShineBorder from "@/components/ui/shine-border";
import BlurFade from "@/components/ui/blur-fade";

const MainMenu = ({ isMoreClicked, setIsMoreClicked }) => {
  const location = useLocation().pathname;

  const MainMenuStyle = {
    background: "linear-gradient(165deg, var(--Ec-4) -50%, var(--Ac-4) 130%)",
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    flexDirection: "row",
    color: "var(--Ac-2)",
    fontSize: "0.6rem",
    borderRadius: "25px",
    flex: "1",
    border: "2px solid var(--Ac-4)",
    height: "100%",
    width: "100%",
    padding: "15px",
  };

  const [isFade, setIsFade] = React.useState(false);
  const MainMenuStyleAnim = useSpring({
    position: "fixed",
    width: "385px",
    height: "60px",
    boxSizing: "border-box",
    zIndex: 10000,
    bottom: isMoreClicked === null ? 10 : 40,
    opacity: isMoreClicked === null ? 1 : 0,
    scale: isMoreClicked === null ? 1 : 0.95,
    filter: isMoreClicked === null ? "blur(0px)" : "blur(2px)",
    onRest: () => isMoreClicked !== null && setIsFade(true),
    onStart: () => isMoreClicked === null && setIsFade(false),
  });
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
    borderRadius: "12px",
    padding: "8px",
    transition: "all 0.3s ease",
  };

  const redirect = useNavigate();
  const redirectClick = () => {
    redirect("/Transactions");
  };
  const handleTransactionsClick = () => {
    setIsMoreClicked("Balance");
    redirectClick("/Transactions");
  };
  return (
    <>
      {!isFade && (
        <animated.div style={{ ...MainMenuStyleAnim }}>
          <BlurFade delay={0.2} style={MainMenuStyle} duration={0.3}>
            <ScalableElement
              as="p"
              style={{
                ...MainMenuPStyle,
                opacity: location === "/" ? 1 : 0.6,
              }}
              // onClick={() => handleClick("Summary")}
            >
              <div
                style={{
                  ...MainMenuSVGStyle,
                  background: location === "/" ? "var(--Bc-4)" : "var(--Ec-4)",
                }}
              >
                <TbHomeStats />
              </div>
              <span
                style={{
                  marginTop: location === "/" ? 0 : -4,
                  transition: "all 0.3s ease",
                }}
              >
                Summary
              </span>
            </ScalableElement>
            <ScalableElement
              as="p"
              style={{
                ...MainMenuPStyle,
                opacity: location === "/Insight" ? 1 : 0.6,
              }}
              // onClick={() => handleClick("Insight")}
            >
              <div
                style={{
                  ...MainMenuSVGStyle,
                  background:
                    location === "/Insight" ? "var(--Bc-4)" : "var(--Ec-4)",
                  // padding: Active == "Insight" ? 8 : 3,
                }}
              >
                <RiDonutChartFill />
              </div>
              <span
                style={{
                  marginTop: location === "/Insight" ? 0 : -4,
                  transition: "all 0.3s ease",
                }}
              >
                Insight
              </span>
            </ScalableElement>
            <ScalableElement as="p">
              <div
                style={{
                  ...MainMenuSVGStyle,
                  fontSize: "1.5rem",
                  padding: "0px",
                  background:
                    "linear-gradient(165deg, var(--Bc-3) -50%, var(--Ec-1) 110%)",
                  outline: "none",
                  borderRadius: "17px",
                }}
              >
                <ShineBorder
                  color={["var(--Bc-3)", "var(--Ac-4)", "var(--Bc-4)"]}
                  borderRadius={17}
                  padding={9}
                  curser="pointer"
                >
                  <HiOutlinePlusSm />
                </ShineBorder>
              </div>
            </ScalableElement>
            <ScalableElement
              as="p"
              style={{
                ...MainMenuPStyle,
                opacity: location === "/Transactions" ? 1 : 0.6,
              }}
              onClick={handleTransactionsClick}
            >
              <div
                style={{
                  ...MainMenuSVGStyle,
                  background:
                    location === "/Transactions"
                      ? "var(--Bc-4)"
                      : "var(--Ec-4)",
                  // padding: Active == "Transactions" ? 8 : 3,
                }}
              >
                <LuLayoutList />
              </div>
              <span
                style={{
                  marginTop: location === "/Transactions" ? 0 : -4,
                  transition: "all 0.3s ease",
                }}
              >
                Transactions
              </span>
            </ScalableElement>
            <ScalableElement
              as="p"
              style={{
                ...MainMenuPStyle,
                opacity: location === "/Acount" ? 1 : 0.6,
              }}
              // onClick={() => handleClick("Acount")}
            >
              <div
                style={{
                  ...MainMenuSVGStyle,
                  background:
                    location === "/Acount" ? "var(--Bc-4)" : "var(--Ec-4)",
                  // padding: Active == "Acount" ? 8 : 3,
                }}
              >
                <IoWalletOutline />
              </div>
              <span
                style={{
                  marginTop: location === "/Acount" ? 0 : -4,
                  transition: "all 0.3s ease",
                }}
              >
                Acount
              </span>
            </ScalableElement>
          </BlurFade>
        </animated.div>
      )}
    </>
  );
};

export default MainMenu;
