/* eslint-disable @typescript-eslint/no-explicit-any */
import Head from "next/head";
import { Box, Button, HStack, Input } from "@chakra-ui/react"
import { BrowserProvider, Wallet, ethers, id } from 'ethers';
import { SiweMessage } from 'siwe';
import { useEffect, useState } from "react";
import { webRTC} from "@libp2p/webrtc"
import { Libp2p, createLibp2p } from "libp2p"
import { Multiaddr, multiaddr } from '@multiformats/multiaddr'
import { noise } from "@chainsafe/libp2p-noise"
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { yamux } from "@chainsafe/libp2p-yamux"
import { MiddlewareRegistrar } from 'libp2p-middleware-registrar'
import { middlewareEVM } from 'libp2p-middleware-evm'
import { EVMRuleEngine, createRulesFromDefinitions } from 'evm-rule-engine'
import type { Networks } from 'evm-rule-engine'
import { webSockets } from "@libp2p/websockets"
import * as filters from "@libp2p/websockets/filters"
import { bootstrap } from "@libp2p/bootstrap";
import { kadDHT } from "@libp2p/kad-dht";
import { Connection, PeerId } from "@libp2p/interface";
import { peerIdFromString } from '@libp2p/peer-id'

export default function Home() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [scheme, setScheme] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [accountBalance, setAccountBalance] = useState<string>("");
  const [signature, setSignature] = useState<string | null>(null);
  const [derivedWallet, setDerivedWallet] = useState<Wallet | null>(null);
  const [derivedWalletAddress, setDerivedWalletAddress] = useState<string | null>(null);
  const [derivedBalance, setDerivedBalance] = useState<string>("");
  const [multiaddrs, setMultiaddrs] = useState<Multiaddr[]>([]);
  const [p2p, setP2P] = useState<Libp2p<any> | null>(null);
  const [dialAddr, setDialAddr] = useState<string>('')
  const [pingAddr, setPingAddr] = useState<string>('')
  const [connections, setConnections] = useState<Connection[]>([])
  const [pingRes, setPingRes] = useState<string>('')

  const networks: Networks = [
    {
      provider: new ethers.JsonRpcProvider('http://127.0.0.1:8545'),
      chainId: '31337'
    }
  ]

  const engine = new EVMRuleEngine({ networks })

  const ruleDefinitions = [
    { type: 'walletBalance', chainId: '31337', params: { value: ethers.parseEther('1'), compareType: 'gte' } },
  ]

  const rules = createRulesFromDefinitions(networks, ruleDefinitions)
  engine.addRules(rules)


  function createSiweMessage (address: string, statement: string) {
    if (scheme === null || domain === null || origin === null) {
      throw new Error('scheme, domain, or origin is not set');
    }

    const message = new SiweMessage({
      scheme,
      domain,
      address,
      statement,
      uri: origin,
      version: '1',
      chainId: 1
    });
    return message.prepareMessage();
  }

  const connectWallet = async () => {
    if (provider == null) {
      throw new Error('provider is not set');
    }

    try { 
      const account = await provider.send('eth_requestAccounts', [])
      setAccount(account[0])
    } catch(err: any) {
      console.log('user rejected request', err.message)
    }
  }

  const signInWithEthereum = async () => {
    if (provider == null) {
      throw new Error('provider is not set');
    }

    const signer = await provider.getSigner();
    const message = createSiweMessage(
      signer.address, 
      'Sign in with Ethereum to the app.'
    );
    try {
      const sig = await signer.signMessage(message)
      setSignature(sig)
    } catch(err: any) {
      console.log(err.message)
    }
  }

  const generateWallet = async () => {
    if (provider == null) {
      throw new Error('provider is not set');
    }

    const message = `sign this ${account}`
    const signer = await provider.getSigner();
    const sig = await signer.signMessage(message)
    const wallet = new Wallet(id(sig), provider)
    setDerivedWallet(wallet)
    setDerivedWalletAddress(await wallet.getAddress())
    console.log(await wallet.getAddress())
  }

  const transferEth = async () => {
    if (provider == null) {
      throw new Error('provider is not set');
    }

    const tx = {
      to: derivedWalletAddress,
      value: ethers.parseEther("1") // Transfer 0.1 ETH
    };

    const signer = await provider.getSigner();
    const transactionResponse = await signer.sendTransaction(tx);
    console.log("Transaction sent, hash:", transactionResponse.hash);
    const receipt = await transactionResponse.wait();
    console.log("Receipt:", receipt);
  }

  const transferEthFromDerived = async () => {
    if (derivedWallet == null) {
      throw new Error('derivedWallet is not set');
    }

    const tx = {
      to: account,
      value: ethers.parseEther("0.25") // Transfer 0.1 ETH
    };

    const signer = derivedWallet;
    const transactionResponse = await signer.sendTransaction(tx);
    console.log("Transaction sent, hash:", transactionResponse.hash);
    const receipt = await transactionResponse.wait();
    console.log("Receipt:", receipt);
  }


  const startP2P = async () => {
    if (derivedWallet == null) {
      throw new Error('derivedWallet is not set');
    }

    const bootstrapMultiaddrs = [
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
      "/dnsaddr/va1.bootstrap.libp2p.io/p2p/12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8",
      "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ", // mars.i.ipfs.io
    ]

    const node = await createLibp2p({
      addresses: {
        listen: [
          '/p2p-circuit',
          `/webrtc`
        ]
      },
      peerDiscovery: [
        bootstrap({
          list: bootstrapMultiaddrs,
        })
      ],
      transports: [
        webSockets({
          filter: filters.all,
        }),
        webRTC(),
        circuitRelayTransport({ }),
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: {
        identify: identify(),
        ping: ping(),
        ping2: ping({
          protocolPrefix: 'secured'
        }),
        dht: kadDHT({
          kBucketSize: 20,
          clientMode: false
        })
      },
      registrar: (components) => {
        const middleware = middlewareEVM({ signer: derivedWallet, evmRuleEngine: engine })

        return new MiddlewareRegistrar(components.registrar, middleware(components), components.logger, { include: ['/secured/ping/1.0.0']})
      }
    })

    await node.start()

    console.log(`Node started with id ${node.peerId.toString()}`)
    console.log('Mutliaddrs', node.getMultiaddrs())
    console.log('Protocols', node.getProtocols())

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    node.addEventListener("self:peer:update", evt => {
      console.log("self peer update", node.getMultiaddrs())
      setMultiaddrs(node.getMultiaddrs())
    })

    setInterval(() => {
      setConnections(node.getConnections())
    }, 1000)

    setP2P(node)
  }

  const stringToDialable = (str: string): PeerId | Multiaddr => {
    let mp: PeerId | Multiaddr | undefined

    try {
      mp = multiaddr(str)
      return mp
    } catch {
      // ignore
    }

    try {
      mp = peerIdFromString(str)
      return mp
    } catch {
      // ignore
    }

    throw new Error('invalid peerId or multiaddr')
  }


  const dial = async () => {
    if (p2p == null) {
      return
    }

    await p2p.dial(stringToDialable(dialAddr))
  }

  const ping2 = async () => {
    setPingRes('')
    console.log(pingAddr)

    if (p2p == null) {
      return
    }

    try {
      setPingRes(await p2p.services.ping2.ping(stringToDialable(pingAddr)))
    } catch (err: any) {
      setPingRes(err.message)
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      const ethProvider = new BrowserProvider(window.ethereum)
      setProvider(ethProvider)
      setScheme(window.location.protocol.slice(0, -1))
      setDomain(window.location.host)
      setOrigin(window.location.origin)
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(async() => {
      if (provider == null) {
        return
      }

      if (account == null) {
        return
      }

      if (derivedWalletAddress == null) {
        return
      }

      setAccountBalance(ethers.formatEther(await provider.getBalance(account)))
      setDerivedBalance(ethers.formatEther(await provider.getBalance(derivedWalletAddress)))
    }, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [account, derivedWalletAddress, provider]);

  return (
    <>
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Generated by create next app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Box>
        <HStack>
          <Button onClick={connectWallet}>Connect wallet</Button>
          <Button onClick={signInWithEthereum}>Sign in</Button>
          <Button onClick={generateWallet}>Generate Derived Wallet</Button>
          <Button onClick={transferEth}>Transfer eth to Derived</Button>
          <Button onClick={transferEthFromDerived}>Transfer eth to main</Button>
          <Button onClick={startP2P}>Start P2P</Button>
        </HStack>
        <HStack><Input placeholder="Dial address" value={dialAddr} onChange={(e) => setDialAddr(e.target.value)}/><Button onClick={dial}>Dial</Button></HStack>
        <HStack><Input placeholder="Ping address" value={pingAddr} onChange={(e) => setPingAddr(e.target.value)}/><Button onClick={ping2}>Ping</Button></HStack>
        <Box>Account: {account}</Box>
        <Box>Signature: {signature}</Box>
        <Box>Derived wallet address: {derivedWalletAddress}</Box>
        <Box>Account Balance: {accountBalance}</Box>
        <Box>Derived Wallet Balance: {derivedBalance}</Box>
        <Box>Ping result: {pingRes}</Box>
        <Box>
          Multiaddrs: 
          <ul>
            {multiaddrs.map((addr, i) => {
              const addrString = addr.toString();
              return (
                <li key={i}>
                  {addrString.includes("webrtc") ? (
                    <strong>{addrString}</strong>
                  ) : (
                    addrString
                  )}
                </li>
              );
            })}
          </ul>
        </Box>
        <Box>Connections: {connections.map((conn, i) => <Box key={i}>{conn.remoteAddr.toString()}</Box>)}</Box>
      </Box>
    </>
  )
}
