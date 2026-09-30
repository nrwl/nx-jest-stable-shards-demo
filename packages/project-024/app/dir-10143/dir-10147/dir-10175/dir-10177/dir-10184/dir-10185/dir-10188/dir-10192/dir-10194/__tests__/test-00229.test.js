const leaf = require('./test-00229.leaf');

test('test-00229', () => {
  const expected = 'test-00229';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
