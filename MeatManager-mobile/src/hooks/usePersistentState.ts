import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function usePersistentState(key: string, initialValue = '') {
  const [value, setValue] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(key)
      .then((storedValue) => {
        if (!isMounted) return;
        if (storedValue !== null) {
          setValue(storedValue);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [key]);

  const saveValue = async (nextValue: string) => {
    setValue(nextValue);

    if (!nextValue) {
      await AsyncStorage.removeItem(key);
      return;
    }

    await AsyncStorage.setItem(key, nextValue);
  };

  return { value, setValue: saveValue, isLoading };
}
