const leaf = require('./test-00095.leaf');

test('test-00095', () => {
  const expected: string = 'test-00095';
  burn(6537);
  expect(leaf.value).toBe(expected);
});
