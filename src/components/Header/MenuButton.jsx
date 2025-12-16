import React, { useState } from "react";
import { animated, useSpring, easings } from "react-spring";

const useMenuAnimation = (isMenuOpen, isMenuIconHovered, TB) => {
  return useSpring({
    width: !isMenuOpen ? (isMenuIconHovered ? "30px" : "15px") : "15px",
    transform: isMenuOpen
      ? TB
        ? "translateY(6.5px) rotate(45deg)"
        : "translateY(-6.5px) rotate(-45deg)"
      : "translateY(0px) rotate(0deg)",
    height: !isMenuOpen ? "2px" : "3px",
    easing: easings.easeOutCubic,
  });
};

const MenuButton = ({
  isMenuOpen,
  handleButtonClick,
  contactInfoAnimation,
}) => {
  const [isMenuIconHovered, setIsMenuIconHovered] = useState(false);

  const topBarAnimation = useMenuAnimation(isMenuOpen, isMenuIconHovered, true);
  const bottomBarAnimation = useMenuAnimation(
    isMenuOpen,
    !isMenuIconHovered,
    false
  );

  return (
    <animated.div
      style={contactInfoAnimation}
      className="HomePage-M-T-R"
      onClick={() => handleButtonClick(!isMenuOpen)}
      onMouseEnter={() => setIsMenuIconHovered(true)}
      onMouseLeave={() => setIsMenuIconHovered(false)}
    >
      <animated.div
        className="MenuIcon-T"
        style={topBarAnimation}
      ></animated.div>
      <animated.div
        className="MenuIcon-B"
        style={bottomBarAnimation}
      ></animated.div>
    </animated.div>
  );
};

export default MenuButton;
