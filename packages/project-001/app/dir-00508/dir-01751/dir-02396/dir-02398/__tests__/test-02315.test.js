const leaf = require('./test-02315.leaf');

test('test-02315', () => {
  const expected = 'test-02315';
  burn(2116);
  expect(leaf.value).toBe(expected);
});
