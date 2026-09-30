const leaf = require('./test-02375.leaf');

test('test-02375', () => {
  const expected = 'test-02375';
  burn(3428);
  expect(leaf.value).toBe(expected);
});
