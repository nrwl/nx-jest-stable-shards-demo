const leaf = require('./test-02139.leaf');

test('test-02139', () => {
  const expected = 'test-02139';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
