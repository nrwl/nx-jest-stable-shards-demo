const leaf = require('./test-02137.leaf');

test('test-02137', () => {
  const expected = 'test-02137';
  burn(10562);
  expect(leaf.value).toBe(expected);
});
