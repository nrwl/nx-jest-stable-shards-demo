const leaf = require('./test-02750.leaf');

test('test-02750', () => {
  const expected = 'test-02750';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
