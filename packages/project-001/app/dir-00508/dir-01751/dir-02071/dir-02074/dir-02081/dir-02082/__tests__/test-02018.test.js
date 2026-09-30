const leaf = require('./test-02018.leaf');

test('test-02018', () => {
  const expected = 'test-02018';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
