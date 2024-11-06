import React, { useState, useEffect, useRef, useCallback } from "react";

const containerStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  overflowY: "scroll",
  height: "190px", // Set height depending on your need
  position: "relative",
  scrollbarWidth: "none", // For Firefox
  msOverflowStyle: "none", // For Internet Explorer and Edge
  backfropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderRadius: "10px",
};

const containerStyleWithScrollbarHidden = {
  ...containerStyle,
  "::-webkit-scrollbar": {
    display: "none", // For Chrome, Safari, and Opera
  },
};

const itemStyle = (opacity, scale) => ({
  opacity,
  scale,
  transition: "opacity 0.5s",
  fontWeight: "400",
  fontSize: "0.8rem",
  margin: "10px",
});

const ScrollableList = ({ item, items, onSelect }) => {
  const [currentIndex, setCurrentIndex] = useState(
    items.indexOf(item) !== -1 ? items.indexOf(item) : items.length
  );
  const containerRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const [dynamicItems, setDynamicItems] = useState(items.concat(items, items));
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const scrollStartY = useRef(0);

  const scrollToCenter = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight / 3;
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const containerMiddle =
      container.getBoundingClientRect().top + container.clientHeight / 2;
    let closestIndex = 0;
    let closestOffset = Number.MAX_VALUE;
    const children = container.children;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childMiddle =
        child.getBoundingClientRect().top + child.clientHeight / 2;
      const offset = Math.abs(containerMiddle - childMiddle);
      if (offset < closestOffset) {
        closestOffset = offset;
        closestIndex = i % items.length;
      }
    }
    setCurrentIndex((prevIndex) =>
      closestIndex !== prevIndex ? closestIndex : prevIndex
    );
  }, [items.length]);

  useEffect(() => {
    scrollToCenter();
  }, [items.length, scrollToCenter]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const debouncedHandleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(handleScroll, 150);
    };

    container.addEventListener("scroll", debouncedHandleScroll, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", debouncedHandleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [handleScroll]);

  useEffect(() => {
    if (containerRef.current) {
      const children = containerRef.current.children;
      if (children[currentIndex + items.length]) {
        children[currentIndex + items.length].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [currentIndex, items.length]);

  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      setCurrentIndex((prevIndex) => {
        let newIndex = e.deltaY > 0 ? prevIndex + 1 : prevIndex - 1;
        if (newIndex < 0) {
          newIndex = items.length - 1;
        } else if (newIndex >= items.length) {
          newIndex = 0;
        }
        return newIndex;
      });
    },
    [items.length]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel);
      }
    };
  }, [handleWheel]);

  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    scrollStartY.current = containerRef.current.scrollTop;
    containerRef.current.style.cursor = "grabbing";
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current) return;
    const deltaY = e.clientY - dragStartY.current;
    containerRef.current.scrollTop = scrollStartY.current - deltaY;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    containerRef.current.style.cursor = "grab";
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener("mousedown", handleMouseDown);
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      if (container) {
        container.removeEventListener("mousedown", handleMouseDown);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp]);

  const handleItemClick = (index) => {
    setCurrentIndex(index % items.length);
    if (onSelect) {
      onSelect(index % items.length);
    }
  };

  return (
    <div style={containerStyleWithScrollbarHidden} ref={containerRef}>
      {dynamicItems.map((item, index) => {
        let opacity = 0;
        let scale = 1;
        const effectiveIndex = index % items.length;

        if (effectiveIndex === currentIndex % items.length) {
          opacity = 1;
          scale = 1;
        } else if (
          effectiveIndex === (currentIndex - 1 + items.length) % items.length ||
          effectiveIndex === (currentIndex + 1) % items.length
        ) {
          opacity = 0.5;
          scale = 0.96;
        } else if (
          effectiveIndex === (currentIndex - 2 + items.length) % items.length ||
          effectiveIndex === (currentIndex + 2) % items.length
        ) {
          opacity = 0.3;
          scale = 0.92;
        }

        return (
          <div
            key={index}
            style={itemStyle(opacity, scale)}
            onClick={() => handleItemClick(effectiveIndex)}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
};

export default ScrollableList;
