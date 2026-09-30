const leaf = require('./test-02434.leaf');

test('test-02434', () => {
  const expected = 'test-02434';
  burn(5003);
  expect(leaf.value).toBe(expected);
});
