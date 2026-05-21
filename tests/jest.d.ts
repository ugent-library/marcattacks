import 'jest-xml-matcher';

declare global {
  namespace jest {
    interface Matchers<R> {
      toEqualXML(expected: string): R;
    }
  }
}