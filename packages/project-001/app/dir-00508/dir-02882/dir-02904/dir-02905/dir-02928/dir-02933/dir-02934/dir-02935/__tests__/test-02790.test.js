const leaf = require('./test-02790.leaf');

test('test-02790', () => {
  const expected = 'test-02790';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
