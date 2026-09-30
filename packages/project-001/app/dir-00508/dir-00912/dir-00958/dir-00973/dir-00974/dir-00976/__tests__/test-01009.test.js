const leaf = require('./test-01009.leaf');

test('test-01009', () => {
  const expected = 'test-01009';
  burn(3081);
  expect(leaf.value).toBe(expected);
});
