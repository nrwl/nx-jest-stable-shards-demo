const leaf = require('./test-00024.leaf');

test('test-00024', () => {
  const expected: string = 'test-00024';
  burn(4050);
  expect(leaf.value).toBe(expected);
});
