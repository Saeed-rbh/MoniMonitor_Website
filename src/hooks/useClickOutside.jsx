import { useEffect } from "react";

/**
 * Custom hook that triggers a callback when clicking outside of the specified element.
 * @param {React.RefObject} ref - The ref of the element to detect clicks outside of.
 * @param {Function} callback - The callback function to execute when clicking outside.
 */
function useClickOutside(ref, callback) {
  useEffect(() => {
    // Handler function to call the callback if the click is outside the element
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        callback();
      }
    }

    // Attach event listener to the document
    document.addEventListener("mousedown", handleClickOutside);

    // Clean up the event listener on component unmount
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, callback]);
}

export default useClickOutside;
