const leaf = require('./test-02731.leaf');

test('test-02731', () => {
  const expected = 'test-02731';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
