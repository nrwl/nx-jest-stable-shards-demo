const leaf = require('./test-00048.leaf');

test('test-00048', () => {
  const expected: string = 'test-00048';
  burn(24375);
  expect(leaf.value).toBe(expected);
});
