export type FunctionType<I, O> = (input: I) => O;

export default function cachedFunction<I, O>(f: FunctionType<I, O>): FunctionType<I, O> {
  const cachedValues: Map<I, O> = new Map();

  return (input: I) => {
    const cachedResult = cachedValues.get(input);
    if (cachedResult) {
      return cachedResult;
    } else {
      const output = f(input);
      cachedValues.set(input, output);
      return output;
    }
  };
}
